// src/components/hub/MarketplaceFeed.jsx
// Marketplace tab — browse listings, buy, trade, and list your own items.

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, X, Coins, Zap,
  ChevronLeft, RefreshCw, Lock,
  ArrowUpDown, Gift, Package, Heart, Star,
} from 'lucide-react';
import CoinShopModal from './CoinShopModal';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';
import * as marketplace from '@/lib/data/marketplace';
import * as inventory   from '@/lib/data/inventory';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { supabase } from '@/api/supabaseClient';
import * as itemSoldCounts from '@/lib/data/itemSoldCounts';
import * as wishlist from '@/lib/data/marketplaceWishlist';
import { findOrCreateConversation, sendMessage } from '@/lib/data/hubMessages';
import { RARITY } from '@/lib/lootCatalog';
import { addRecentlyViewed } from '@/lib/recentlyViewedListings';
import { useNumberFormatter } from '@/lib/intl';
import RecentlyViewedRail from './RecentlyViewedRail';

// ─── Daily Chest helpers ──────────────────────────────────────────────────────
// Was: localStorage-only claim gate. That was a coin minter — clear
// localStorage / use incognito / use a second device → re-claim. The
// server has no idea. Replaced by the claim_daily_chest RPC (migration
// 068) which atomically checks user_profiles.last_daily_chest_at and
// only credits once per UTC day. We KEEP a localStorage hint for the
// initial UI state so the chest doesn't flicker into the "available"
// look on every cold load, but the source of truth is the server.

const CHEST_KEY = (userId) => `daily_chest_claimed_${userId}`;

function isDailyChestClaimedLocally(userId) {
  if (!userId) return false;
  const val = localStorage.getItem(CHEST_KEY(userId));
  if (!val) return false;
  // Compare on UTC date — server-side claim_daily_chest (mig 068) gates
  // on `(last_daily_chest_at AT TIME ZONE 'UTC')::DATE < v_today_utc`,
  // so the client MUST use the same axis. Previous local-TZ comparison
  // disagreed with the server during the user's late evening (local
  // calendar already tomorrow, UTC still today → UI said "claimed" but
  // server hadn't reset) and again during their early morning (local
  // still yesterday, UTC already today → UI said "available" but the
  // last claim already counted for today).
  const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);
  return utcDate(val) === utcDate(new Date().toISOString());
}

function markDailyChestClaimedLocally(userId) {
  if (!userId) return;
  localStorage.setItem(CHEST_KEY(userId), new Date().toISOString());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function RarityBadge({ rarity, small = false }) {
  const rc = RARITY[rarity] ?? RARITY.common;
  return (
    <span
      className={`inline-block font-bold rounded-full border ${small ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}`}
      style={{ color: rc.color, borderColor: rc.color, background: `${rc.color}18` }}
    >
      {rc.label}
    </span>
  );
}

// ─── Listing Card ─────────────────────────────────────────────────────────────
function ListingCard({ listing, currentUser, flexCoins, onBuy, onCancel, onOfferTrade, recentlySold = false, boughtByMe = false, soldCount = 0, onSellerClick, isSaved = false, onToggleSave }) {
  const fmt = useNumberFormatter();
  const isMine      = listing.seller_email === currentUser?.email;
  const isSale      = listing.listing_type === 'sale';
  const canAfford   = isSale && flexCoins >= (listing.asking_price ?? 0);
  const rc          = RARITY[listing.item_rarity] ?? RARITY.common;
  const soldLabel   = itemSoldCounts.formatSoldCount(soldCount);
  const isFeatured  = !!listing.is_featured && listing.featured_until && new Date(listing.featured_until) > new Date();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={[
        'flex flex-col rounded-xl border-2 bg-[#0f0f2a] p-3 gap-2 relative overflow-hidden transition-opacity',
        rc.borderClass,
        isFeatured ? 'ring-2 ring-amber-400/70' : '',
        recentlySold ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Featured ribbon (mig 122) */}
      {isFeatured && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-400 text-amber-950 text-[9px] font-extrabold uppercase tracking-wider">
          <Star className="w-2.5 h-2.5 fill-current" /> Featured
        </div>
      )}
      {/* Heart save-for-later (mig 121) — hidden on own listings */}
      {!isMine && !recentlySold && onToggleSave && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSave(listing.id); }}
          aria-label={isSaved ? 'Remove from saved' : 'Save for later'}
          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-black/55 flex items-center justify-center hover:bg-black/75 transition-colors"
        >
          <Heart className={`w-3.5 h-3.5 ${isSaved ? 'fill-red-500 text-red-500' : 'text-white/80'}`} />
        </button>
      )}
      {/* Subtle rarity glow */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${rc.color}12, transparent)` }}
      />

      {/* Sold stamp — when a listing transitions to sold (via realtime
          or polled refresh) we keep the card visible for ~5s with a
          diagonal SOLD overlay before it collapses out of the grid.
          Communicates marketplace activity + creates urgency for the
          listings still active. Self-buy gets the warmer YOURS! variant. */}
      {recentlySold && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
          aria-hidden="true"
        >
          <span
            className="font-black text-2xl tracking-widest text-rose-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] rotate-[-12deg] select-none"
            style={{ textShadow: '0 0 8px rgba(0,0,0,0.4)' }}
          >
            {boughtByMe ? 'YOURS!' : 'SOLD'}
          </span>
        </div>
      )}

      {/* Item */}
      <div className="flex flex-col items-center gap-1 relative z-10">
        <span className="text-4xl leading-none">{listing.item_emoji}</span>
        <span className="text-white text-xs font-semibold text-center leading-tight">{listing.item_name}</span>
        <RarityBadge rarity={listing.item_rarity} small />
      </div>

      {/* Seller — tap to open their HubProfile. Excludes own listings. */}
      <p className="text-gray-500 text-[10px] text-center relative z-10">
        by{' '}
        {isMine || !onSellerClick ? (
          <span className="text-gray-400 font-medium">
            {listing.seller_username || listing.seller_email.split('@')[0]}
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSellerClick(listing.seller_email); }}
            className="text-gray-300 font-medium hover:text-white hover:underline"
          >
            {listing.seller_username || listing.seller_email.split('@')[0]}
          </button>
        )}
        {soldLabel && (
          <span className="text-gray-500"> · {soldLabel}</span>
        )}
      </p>

      {/* Listing type badge */}
      <div className="flex justify-center relative z-10">
        {isSale ? (
          <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">
            <Coins className="w-3 h-3" /> For Sale
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full px-2 py-0.5">
            <Zap className="w-3 h-3" /> For Trade
          </span>
        )}
      </div>

      {/* Price / trade req */}
      <div className="text-center relative z-10">
        {isSale ? (
          <p className="text-amber-300 font-bold text-sm">🪙 {fmt(listing.asking_price ?? 0)}</p>
        ) : (
          <p className="text-blue-300 text-xs font-medium">
            Want: <span className="capitalize">{listing.trade_for_rarity ?? 'any'}+</span>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 relative z-10 mt-auto">
        {isMine ? (
          <button
            onClick={() => onCancel(listing)}
            className="w-full py-1.5 rounded-lg text-xs font-bold text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors"
          >
            Cancel
          </button>
        ) : isSale ? (
          <button
            onClick={() => onBuy(listing)}
            disabled={!canAfford}
            className={[
              'w-full py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1',
              canAfford
                ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40 hover:bg-amber-500/30'
                : 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed',
            ].join(' ')}
          >
            {!canAfford && <Lock className="w-3 h-3" />}
            Buy · 🪙 {fmt(listing.asking_price ?? 0)}
          </button>
        ) : (
          <button
            onClick={() => onOfferTrade(listing)}
            className="w-full py-1.5 rounded-lg text-xs font-bold text-blue-300 bg-blue-500/10 border border-blue-400/30 hover:bg-blue-500/20 transition-colors"
          >
            Offer Trade
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Bundle Card ─────────────────────────────────────────────────────────────
// Shows all sale-type listings in a bundle as a grouped row with discount badge.
// The "Buy Bundle" button fires the purchase_bundle RPC.
function BundleCard({ bundle, listings, currentUser, flexCoins, onBuyBundle }) {
  const fmt = useNumberFormatter();
  const isMine = bundle.seller_email === currentUser?.email;
  const totalPrice = listings.reduce((sum, l) => sum + (l.asking_price ?? 0), 0);
  const discountedPrice = Math.max(1, Math.round(totalPrice * (1 - bundle.discount_pct / 100)));
  const savings = totalPrice - discountedPrice;
  const canAfford = flexCoins >= discountedPrice;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="col-span-full rounded-xl border-2 border-amber-400/50 bg-[#0f0f2a] p-4 gap-3 flex flex-col relative overflow-hidden"
    >
      {/* Bundle badge */}
      <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-amber-950 text-[10px] font-extrabold uppercase tracking-wide">
        <Package className="w-3 h-3" /> Bundle · {bundle.discount_pct}% off
      </div>

      <div>
        <p className="font-bold text-white text-sm pr-24">{bundle.title}</p>
        <p className="text-gray-400 text-[11px] mt-0.5">
          by {bundle.seller_email?.split('@')[0]} · {listings.length} items
        </p>
      </div>

      {/* Item emoji row */}
      <div className="flex flex-wrap gap-2">
        {listings.map(l => (
          <div key={l.id} className="flex flex-col items-center gap-0.5">
            <span className="text-2xl">{l.item_emoji}</span>
            <RarityBadge rarity={l.item_rarity} small />
          </div>
        ))}
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-3">
        <span className="text-gray-500 text-xs line-through">🪙 {fmt(totalPrice)}</span>
        <span className="text-amber-300 font-bold text-base">🪙 {fmt(discountedPrice)}</span>
        <span className="text-emerald-400 text-xs font-semibold">Save {fmt(savings)}</span>
      </div>

      {!isMine && (
        <button
          onClick={() => onBuyBundle(bundle, listings, discountedPrice)}
          disabled={!canAfford}
          className={[
            'w-full py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5',
            canAfford
              ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40 hover:bg-amber-500/30'
              : 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed',
          ].join(' ')}
        >
          {!canAfford && <Lock className="w-3.5 h-3.5" />}
          Buy bundle · 🪙 {fmt(discountedPrice)}
        </button>
      )}
    </motion.div>
  );
}

// ─── List Item Dialog ─────────────────────────────────────────────────────────
function ListItemDialog({ open, onClose, userItems, user, onSuccess }) {
  const { t, tFallback } = useLanguage();
  const qc = useQueryClient();
  const [step, setStep]             = useState('pick');   // 'pick' | 'configure'
  const [selectedItem, setSelected] = useState(null);
  const [listingType, setListingType] = useState('sale');
  const [price, setPrice]           = useState('');
  const [tradeRarity, setTradeRarity] = useState('uncommon');
  const [busy, setBusy]             = useState(false);

  const reset = () => { setStep('pick'); setSelected(null); setListingType('sale'); setPrice(''); setTradeRarity('uncommon'); };

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
        seller_user_id:  user.id,
        seller_email:    user.email,
        seller_username: user.username ?? user.display_name ?? user.email.split('@')[0],
        inventory_id:    selectedItem.id,
        item_id:         selectedItem.item_id,
        item_name:       selectedItem.item_name,
        item_emoji:      selectedItem.item_emoji,
        item_rarity:     selectedItem.item_rarity,
        listing_type:    listingType,
        asking_price:    listingType === 'sale' ? parseInt(price, 10) : null,
        trade_for_rarity: listingType === 'trade' ? tradeRarity : null,
      });
      await inventory.setListed(selectedItem.id, true);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      toast.success('Listed. Good luck.');
      handleClose();
      onSuccess?.();
    } catch (err) {
      // Generic toast, full detail to Sentry. Raw error.message can
      // leak Postgres column / RLS hints that aid schema mapping.
      reportError(err, { feature: 'marketplace.list', level: 'warning', userEmail: user?.email, itemId: selectedItem?.id });
      toast.error('Could not list item — try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/70"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
      />
      <motion.div
        className="relative z-10 bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            {step === 'configure' && (
              <button onClick={() => setStep('pick')} className="text-gray-400 hover:text-white mr-1">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <ShoppingBag className="w-5 h-5 text-purple-400" />
            <h3 className="text-white font-bold">{step === 'pick' ? 'Choose Item to List' : 'Configure Listing'}</h3>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {step === 'pick' && (
            <div>
              {unlistedItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No stickers available to list. Open capsules to get more!
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {unlistedItems.map(item => {
                    const rc = RARITY[item.item_rarity] ?? RARITY.common;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setSelected(item); setStep('configure'); }}
                        className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all hover:scale-105 ${rc.borderClass} bg-[#0f0f2a]`}
                      >
                        <span className="text-3xl">{item.item_emoji}</span>
                        <span className="text-white text-[10px] font-semibold mt-1 text-center leading-tight">{item.item_name}</span>
                        <RarityBadge rarity={item.item_rarity} small />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 'configure' && selectedItem && (
            <div className="flex flex-col gap-4">
              {/* Selected item preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-3xl">{selectedItem.item_emoji}</span>
                <div>
                  <p className="text-white font-semibold text-sm">{selectedItem.item_name}</p>
                  <RarityBadge rarity={selectedItem.item_rarity} small />
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
                        ? 'bg-purple-600/30 border-purple-400 text-purple-200'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20',
                    ].join(' ')}
                  >
                    {type === 'sale' ? '🪙 For Sale' : '⚡ For Trade'}
                  </button>
                ))}
              </div>

              {/* Sale price */}
              {listingType === 'sale' && (
                <div>
                  <label className="text-gray-400 text-xs font-semibold mb-1.5 block">Asking Price (Flex Coins)</label>
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                    <span>🪙</span>
                    <input
                      type="number" inputMode="decimal"
                      min="1"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="e.g. 50"
                      className="flex-1 bg-transparent text-white text-sm outline-none placeholder-gray-600"
                    />
                  </div>
                </div>
              )}

              {/* Trade rarity min */}
              {listingType === 'trade' && (
                <div>
                  <label className="text-gray-400 text-xs font-semibold mb-1.5 block">Minimum Rarity Wanted</label>
                  <select
                    value={tradeRarity}
                    onChange={e => setTradeRarity(e.target.value)}
                    className="w-full bg-[#0f0f2a] border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none"
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
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm disabled:opacity-50 transition-opacity hover:opacity-90"
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

// ─── Trade Offer Dialog ───────────────────────────────────────────────────────
function TradeOfferDialog({ open, listing, userItems, user, onClose }) {
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [busy, setBusy]                   = useState(false);

  const eligibleItems = (userItems ?? []).filter(
    i => !i.is_listed && i.item_type === 'sticker' && i.item_id !== listing?.item_id
  );

  const handleSend = async () => {
    if (!selectedOffer || !listing) return;
    setBusy(true);
    try {
      const conv = await findOrCreateConversation(user.email, listing.seller_email);
      if (!conv) throw new Error('Could not open conversation');

      // Structured payload — HubChat detects the [TRADE_OFFER_V1] prefix and
      // renders an interactive card instead of raw text. Plain-text fallback
      // is concatenated below so older clients (or copy/paste) still see
      // something readable.
      const fromName = user.username ?? user.email.split('@')[0];
      const tradePayload = {
        v: 1,
        type: 'trade_offer',
        // Stable id so the receiver's TradeOfferCard can persist their
        // response across chat re-mount via localStorage. Without this the
        // accept/decline buttons reappeared every time the chat scrolled.
        offerId: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
        fromEmail: user.email,
        fromName,
        toEmail: listing.seller_email,
        myItem: {
          inventoryId: selectedOffer.id,
          itemId: selectedOffer.item_id,
          name: selectedOffer.item_name,
          emoji: selectedOffer.item_emoji,
          rarity: selectedOffer.item_rarity,
        },
        theirItem: {
          listingId: listing.id,
          itemId: listing.item_id,
          name: listing.item_name,
          emoji: listing.item_emoji,
          rarity: listing.item_rarity,
          // marketplace_listings stores the price as asking_price (see
          // listingType === 'sale' write at the other end of this file).
          // The trade offer DM template was reading listing.price which
          // doesn't exist on the row, so every trade-offer message had
          // price: null and the recipient saw the listed price as blank.
          price: listing.asking_price ?? null,
        },
        createdAt: new Date().toISOString(),
      };
      const body = [
        '[TRADE_OFFER_V1]' + JSON.stringify(tradePayload),
        '',
        `🔁 Trade Offer from ${fromName}`,
        `I'm offering: ${selectedOffer.item_emoji} ${selectedOffer.item_name} (${RARITY[selectedOffer.item_rarity]?.label ?? selectedOffer.item_rarity})`,
        `For your: ${listing.item_emoji} ${listing.item_name} listed in the Marketplace.`,
        `Reply to accept or decline!`,
      ].join('\n');
      await sendMessage({ conversationId: conv.id, senderEmail: user.email, recipientEmail: listing.seller_email, body });
      toast.success('Trade offer sent — watch your messages.');
      onClose();
    } catch (err) {
      reportError(err, { feature: 'marketplace.trade-offer', level: 'warning', userEmail: user?.email, listingId: listing?.id });
      toast.error('Could not send trade offer — try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open || !listing) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/70"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/10">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-400" /> Offer a Trade
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="text-sm text-gray-400">
            Offering for: <span className="text-white font-semibold">{listing.item_emoji} {listing.item_name}</span>
          </div>

          <p className="text-xs text-gray-500">Choose a sticker from your bag to offer:</p>

          {eligibleItems.length === 0 ? (
            <p className="text-center text-gray-600 text-sm py-4">No eligible stickers to offer.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto">
              {eligibleItems.map(item => {
                const rc = RARITY[item.item_rarity] ?? RARITY.common;
                const picked = selectedOffer?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedOffer(item)}
                    className={[
                      'flex flex-col items-center p-2 rounded-xl border-2 transition-all',
                      picked ? `${rc.borderClass} ring-2 ring-offset-1 ring-offset-[#0a0a1a]` : `${rc.borderClass} opacity-70 hover:opacity-100`,
                      'bg-[#0f0f2a]',
                    ].join(' ')}
                    style={picked ? { ringColor: RARITY[item.item_rarity]?.color } : {}}
                  >
                    <span className="text-2xl">{item.item_emoji}</span>
                    <span className="text-white text-[9px] font-semibold mt-0.5 text-center">{item.item_name}</span>
                    <RarityBadge rarity={item.item_rarity} small />
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={!selectedOffer || busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {busy ? 'Sending…' : 'Send Trade Offer via DM'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Buy Confirm Dialog ───────────────────────────────────────────────────────
function BuyConfirmDialog({ open, listing, onClose, onConfirm, busy }) {
  const fmt = useNumberFormatter();
  if (!open || !listing) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/70"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-4"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h3 className="text-white font-bold text-lg text-center">Confirm Purchase</h3>
        <div className="flex flex-col items-center gap-2">
          <span className="text-5xl">{listing.item_emoji}</span>
          <p className="text-white font-semibold">{listing.item_name}</p>
          <RarityBadge rarity={listing.item_rarity} />
          <p className="text-amber-300 font-bold text-lg mt-1">🪙 {fmt(listing.asking_price ?? 0)} Flex Coins</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-white/10 text-white font-semibold text-sm hover:bg-white/20 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">
            {busy ? 'Buying…' : 'Buy Now'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Ambient particle data ────────────────────────────────────────────────────
// Marketplace header — purple/indigo drift particles
const MKT_PARTICLES = [
  { x: 8,  size: 3, dur: 5.2, delay: 0,    travel: 38, color: '#a78bfa' },
  { x: 20, size: 2, dur: 6.8, delay: 1.4,  travel: 28, color: '#818cf8' },
  { x: 38, size: 4, dur: 4.5, delay: 0.7,  travel: 44, color: '#c4b5fd' },
  { x: 55, size: 2, dur: 7.1, delay: 2.1,  travel: 32, color: '#a78bfa' },
  { x: 68, size: 3, dur: 5.6, delay: 0.3,  travel: 40, color: '#818cf8' },
  { x: 80, size: 2, dur: 6.2, delay: 1.9,  travel: 26, color: '#fde68a' },
  { x: 90, size: 3, dur: 4.9, delay: 1.1,  travel: 36, color: '#c4b5fd' },
  { x: 45, size: 2, dur: 7.4, delay: 3.0,  travel: 24, color: '#fde68a' },
];

// Daily chest — golden/amber drift particles
const CHEST_PARTICLES = [
  { x: 12, size: 3, dur: 5.4, delay: 0,    travel: 34, color: '#fde68a' },
  { x: 28, size: 2, dur: 6.5, delay: 0.8,  travel: 26, color: '#fbbf24' },
  { x: 50, size: 4, dur: 4.8, delay: 1.6,  travel: 42, color: '#fde68a' },
  { x: 70, size: 2, dur: 7.0, delay: 0.4,  travel: 30, color: '#a78bfa' },
  { x: 85, size: 3, dur: 5.8, delay: 2.2,  travel: 38, color: '#fbbf24' },
  { x: 40, size: 2, dur: 6.8, delay: 3.5,  travel: 22, color: '#fde68a' },
];

// ─── Rotating gradient header ─────────────────────────────────────────────────
function MarketplaceHeader({ flexCoins, onRefresh, onList, listableCount = 0, sortBy, sortDir, onSortByChange, onSortDirToggle, onOpenTradeHistory }) {
  const fmt = useNumberFormatter();
  const angleRef = useRef(0);
  const rafRef = useRef(null);
  const prevTimeRef = useRef(null);
  const [gradientAngle, setGradientAngle] = useState(0);

  useEffect(() => {
    const tick = (time) => {
      if (prevTimeRef.current !== null) {
        const delta = time - prevTimeRef.current;
        angleRef.current = (angleRef.current + delta * 0.018) % 360;
        setGradientAngle(Math.round(angleRef.current));
      }
      prevTimeRef.current = time;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: `linear-gradient(${gradientAngle}deg, #1a0538 0%, #2d0a5e 40%, #1e0850 70%, #160438 100%)`,
        border: '1px solid #5b21b6',
      }}
    >
      {/* Ambient drift particles */}
      {MKT_PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none rounded-full"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            bottom: 0,
            background: p.color,
            opacity: 0,
            filter: 'blur(0.5px)',
          }}
          animate={{ y: [0, -p.travel], opacity: [0, 0.55, 0] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* Row 1: title + coins + bag + list button */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-purple-300" />
          <h2 className="text-white font-bold text-lg">Marketplace</h2>
          <button
            onClick={onRefresh}
            className="text-purple-300 hover:text-white transition-colors p-1 rounded-lg hover:bg-purple-800"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {/* Trade history — opens the consolidated timeline of every
              trade offer the viewer sent or received (mig-free, reads
              from the existing hub_messages markers). */}
          <a
            href="/market/trades"
            onClick={(e) => { e.preventDefault(); onOpenTradeHistory?.(); }}
            className="text-purple-300 hover:text-white transition-colors p-1 rounded-lg hover:bg-purple-800"
            aria-label="Trade history"
            title="Trade history"
          >
            <ArrowUpDown className="w-4 h-4" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-amber-400 rounded-full px-3 py-1.5">
            <span className="text-base">🪙</span>
            <span className="text-gray-900 font-bold text-sm">{fmt(flexCoins)}</span>
          </div>
          {/* My Bag — opens the bag/capsules drawer via the global
              OPEN_BAG_EVENT. Avoids forcing the user to navigate back
              to ProfileMenu just to open their inventory. Also drives
              the capsule-open flow: tap → open capsule → close opener
              → bag re-opens automatically (see inventoryFlow.js). */}
          <button
            onClick={requestOpenBag}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-purple-900 border border-purple-600 text-white font-bold text-sm hover:bg-purple-800 transition-colors"
            aria-label="Open My Bag"
          >
            <Package className="w-4 h-4" />
            <span>My Bag</span>
          </button>
          <button
            onClick={onList}
            // Live count of listable items (stickers you own that aren't
            // already listed). Removes the wasted tap-and-discover cycle
            // for users with nothing to sell; doubles as a satisfying
            // tick-up when a capsule opens and inventory grows.
            className={`px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm shadow-lg hover:opacity-90 transition-opacity ${listableCount === 0 ? 'opacity-60' : ''}`}
          >
            List Item{listableCount > 0 && <span className="ml-1 text-purple-200 font-semibold tabular-nums">· {listableCount > 99 ? '99+' : listableCount}</span>}
          </button>
        </div>
      </div>

      {/* Row 2: two-button sort — parameter toggle + directional toggle */}
      <div className="flex items-center gap-2">
        {/* Button 1: Parameter toggle (Recent ↔ Price) */}
        <button
          onClick={() => onSortByChange(sortBy === 'recent' ? 'price' : 'recent')}
          className="flex items-center gap-1.5 bg-purple-900 border border-purple-600 text-white text-xs font-semibold rounded-full px-3.5 py-1.5 hover:bg-purple-800 active:scale-95 transition-all select-none"
        >
          {sortBy === 'recent' ? '🕐 Recent' : '🏷️ Price'}
        </button>
        {/* Button 2: Directional toggle (asc ↔ desc). On Recent mode
            it auto-switches to Price + flips direction (handled by
            the parent's onSortDirToggle), so it's ALWAYS clickable —
            previously it was disabled on Recent and a tap silently
            no-op'd, which users read as "filter button is broken." */}
        <button
          onClick={onSortDirToggle}
          className={`flex items-center gap-1 border text-xs font-semibold rounded-full px-3.5 py-1.5 hover:bg-purple-800 active:scale-95 transition-all select-none ${
            sortBy === 'price'
              ? 'bg-purple-900 border-purple-600 text-white'
              : 'bg-purple-950/60 border-purple-700/60 text-purple-200'
          }`}
        >
          <ArrowUpDown className="w-3 h-3" />
          {sortDir === 'desc' ? 'High → Low' : 'Low → High'}
        </button>
      </div>
    </div>
  );
}

// ─── Daily Chest block ────────────────────────────────────────────────────────
function DailyChestBlock({ user, onClaimed }) {
  const { t, tFallback } = useLanguage();
  // localStorage hint avoids the "available" flicker on cold loads, but
  // the server is the source of truth — the claim RPC enforces the
  // once-per-UTC-day rule even if localStorage is wiped or this is a
  // different browser / device.
  const [claimed, setClaimed] = useState(() => isDailyChestClaimedLocally(user?.id));
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    if (claimed || loading || !user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('claim_daily_chest');
      if (error) throw error;

      if (data?.already_claimed) {
        // Server says we already claimed today (probably from another
        // device). Quietly sync local state without celebrating again.
        markDailyChestClaimedLocally(user.id);
        setClaimed(true);
        return;
      }

      // Real claim landed. Optimistically reflect the new balance / new
      // capsule in cached queries; the parent's onClaimed fires the
      // refetch chain.
      markDailyChestClaimedLocally(user.id);
      setClaimed(true);
      toast.success(tFallback('marketplace.dailyChest.claimSuccess', '🎁 Daily chest claimed! Check your capsules.'));
      onClaimed?.();
    } catch (err) {
      // Pre-migration host (RPC missing) or network error. Do NOT
      // mark claimed locally — let the user retry. The previous code
      // marked claimed-on-failure to avoid spam clicks; that defeated
      // the safety check the moment the RPC was added.
      reportError(err, { feature: 'marketplace.daily-chest-claim', level: 'warning', userEmail: user?.email });
      toast.error(
        tFallback('marketplace.dailyChest.claimFailed', 'Could not claim — try again in a moment.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #2d0f5a 0%, #1a0a3e 100%)',
        border: '1px solid #5b21b6',
      }}
    >
      {/* Ambient golden drift particles */}
      {CHEST_PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none rounded-full"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            bottom: 0,
            background: p.color,
            opacity: 0,
            filter: 'blur(0.5px)',
          }}
          animate={{ y: [0, -p.travel], opacity: [0, 0.6, 0] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-purple-800 border border-purple-600 flex items-center justify-center">
        <Gift className={`w-6 h-6 ${claimed ? 'text-yellow-200/50' : 'text-yellow-300'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">{tFallback('marketplace.dailyChest.title', 'Daily Chest')}</p>
        <p className="text-purple-100 font-medium text-xs mt-0.5">
          {claimed
            ? (tFallback('marketplace.dailyChest.comeback', 'Come back tomorrow for another reward!'))
            : (tFallback('marketplace.dailyChest.cta', 'Claim your free daily capsule + coins'))}
        </p>
      </div>
      <button
        onClick={handleClaim}
        disabled={claimed || loading}
        className={[
          'shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all',
          claimed
            ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
            : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:opacity-90 shadow-md',
        ].join(' ')}
      >
        {loading ? '…' : claimed ? (tFallback('marketplace.dailyChest.claimed', 'Claimed')) : (tFallback('marketplace.dailyChest.claim', 'Claim'))}
      </button>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MarketplaceFeed() {
  const { user } = useAuth();
  const qc       = useQueryClient();

  const [showListDialog,   setShowListDialog]  = useState(false);
  const [tradeTarget,      setTradeTarget]     = useState(null);
  const [buyTarget,        setBuyTarget]       = useState(null);
  const [buyBusy,          setBuyBusy]         = useState(false);
  const [shopOpen,         setShopOpen]        = useState(false);

  // Sold-fade tracking — set of listing IDs that just disappeared
  // from the active feed. We render the SOLD overlay for ~5s before
  // the listing actually collapses out of the grid. boughtByMe is a
  // separate set so we can show the warmer YOURS! variant for buys
  // the current user just made.
  const [recentlySold,  setRecentlySold]  = useState(() => new Set());
  const [boughtByMeIds, setBoughtByMeIds] = useState(() => new Set());
  const previousListingsRef = useRef([]);

  // Feature 21: sort controls
  const [sortBy,  setSortBy]  = useState('recent'); // 'recent' | 'price'
  const [sortDir, setSortDir] = useState('desc');   // 'asc' | 'desc'

  // Top-level view: 'browse' shows the full marketplace, 'saved' shows
  // the viewer's wishlist only (heart-saved listings).
  const [marketView, setMarketView] = useState('browse'); // 'browse' | 'saved'

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: rawListings, isLoading: loadingListings, isError: listingsError, refetch } = useQuery({
    queryKey: ['marketplaceListings', sortBy, sortDir],
    queryFn:  () => marketplace.listActive(60, sortBy, sortDir),
    staleTime: 15_000,
  });
  const listings = Array.isArray(rawListings) ? rawListings : [];

  // Sold-counts lookup — one bulk query for every visible listing's
  // item_id. Re-runs only when the set of visible item_ids changes.
  const visibleItemIds = useMemo(
    () => Array.from(new Set(listings.map(l => l.item_id).filter(Boolean))),
    [listings]
  );
  const { data: soldCountMap = new Map() } = useQuery({
    queryKey: ['itemSoldCounts', visibleItemIds.join(',')],
    queryFn:  () => itemSoldCounts.countsFor(visibleItemIds),
    enabled:  visibleItemIds.length > 0,
    staleTime: 60_000,
  });

  // Single navigate handler threaded into every ListingCard's seller
  // link. Routes to /hub?profile=<email> — the canonical profile URL.
  const navigate = useNavigate();
  const handleSellerClick = useCallback((email) => {
    if (!email) return;
    navigate(`/hub?profile=${encodeURIComponent(email)}`);
  }, [navigate]);

  // Wishlist (mig 121). Single query for the viewer's saved
  // listing ids; toggle handler is optimistic via setQueryData so
  // the heart fills/unfills instantly.
  const { data: savedIds = new Set() } = useQuery({
    queryKey: ['marketplaceWishlist', user?.id],
    queryFn:  async () => {
      const rows = await wishlist.listMine(user.id);
      return new Set(rows.map(r => r.listing_id));
    },
    enabled:   !!user?.id,
    staleTime: 60_000,
  });
  const handleToggleSave = useCallback(async (listingId) => {
    if (!user?.id || !listingId) return;
    const currentlySaved = savedIds.has(listingId);
    // Optimistic update.
    qc.setQueryData(['marketplaceWishlist', user.id], (prev) => {
      const next = new Set(prev || []);
      if (currentlySaved) next.delete(listingId); else next.add(listingId);
      return next;
    });
    try {
      await wishlist.toggle(user.id, listingId, currentlySaved);
    } catch {
      // Revert on failure.
      qc.setQueryData(['marketplaceWishlist', user.id], (prev) => {
        const next = new Set(prev || []);
        if (currentlySaved) next.add(listingId); else next.delete(listingId);
        return next;
      });
      toast.error('Could not update wishlist — try again.');
    }
  }, [user?.id, savedIds, qc]);

  // Bundle deals (migration 134) — fetch active bundles and group
  // their member listings for the special bundle card row.
  const { data: activeBundles = [] } = useQuery({
    queryKey: ['marketplaceBundles'],
    queryFn: marketplace.listActiveBundles,
    staleTime: 60_000,
  });

  // Group listings by bundle_id so BundleCard gets a pre-filtered list.
  const bundleMap = useMemo(() => {
    const map = new Map(); // bundleId → [listing, ...]
    listings.forEach(l => {
      if (!l.bundle_id) return;
      if (!map.has(l.bundle_id)) map.set(l.bundle_id, []);
      map.get(l.bundle_id).push(l);
    });
    return map;
  }, [listings]);

  // IDs already shown inside a bundle card — exclude from the regular grid.
  const bundledListingIds = useMemo(() => {
    const ids = new Set();
    bundleMap.forEach(ls => ls.forEach(l => ids.add(l.id)));
    return ids;
  }, [bundleMap]);

  const handleBuyBundle = useCallback(async (bundle, bundleListings, paidPrice) => {
    if (!user?.id) return;
    try {
      const result = await marketplace.purchaseBundle(bundle.id);
      toast.success(`Bundle purchased! 🪙 ${result.paid_price} spent. Items are yours.`);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['marketplaceBundles'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
    } catch (err) {
      const msg = err.message?.includes('insufficient_coins')
        ? 'Not enough coins for this bundle.'
        : err.message?.includes('bundle_not_available')
        ? 'This bundle is no longer available.'
        : 'Could not purchase bundle — try again.';
      toast.error(msg);
    }
  }, [user?.id, user?.email, qc]);

  // Featured listings — derived from the active list (already
  // fetched). When any exist with a future featured_until, render
  // them in a top rail above the regular grid.
  const featuredListings = useMemo(
    () => listings.filter(l =>
      l.is_featured && l.featured_until && new Date(l.featured_until) > new Date()
    ),
    [listings]
  );

  // Detect listings that disappeared between the previous render and
  // this one — those are the just-sold (or cancelled) ones. Mark them
  // for a 5s "sold-fade" overlay, then clean them up. boughtByMe is
  // tracked separately so the buy handler can flag a self-buy for the
  // YOURS! variant just before the listing leaves the feed.
  useEffect(() => {
    const prevIds = new Set(previousListingsRef.current.map(l => l.id));
    const currIds = new Set(listings.map(l => l.id));
    const disappeared = [...prevIds].filter(id => !currIds.has(id));
    if (disappeared.length === 0) {
      previousListingsRef.current = listings;
      return;
    }
    // Stitch the just-gone listings back into a local copy so the
    // SOLD card stays visible while the fade plays.
    setRecentlySold(prev => {
      const next = new Set(prev);
      disappeared.forEach(id => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setRecentlySold(prev => {
        const next = new Set(prev);
        disappeared.forEach(id => next.delete(id));
        return next;
      });
      setBoughtByMeIds(prev => {
        const next = new Set(prev);
        disappeared.forEach(id => next.delete(id));
        return next;
      });
    }, 5000);
    previousListingsRef.current = listings;
    return () => clearTimeout(timer);

  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: rawMyItems } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email,
    staleTime: 30_000,
  });
  const myItems = Array.isArray(rawMyItems) ? rawMyItems : [];

  const flexCoins = user?.flex_coins ?? 0;

  // ── Cancel listing ─────────────────────────────────────────────────────────
  const handleCancel = useCallback(async (listing) => {
    try {
      await marketplace.cancelListing(listing.id);
      await inventory.setListed(listing.inventory_id, false);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
      toast.success('Pulled it back.');
    } catch (err) {
      reportError(err, { feature: 'marketplace.cancel-listing', level: 'warning', userEmail: user?.email, listingId: listing?.id });
      toast.error('Could not cancel — try again.');
    }
  }, [qc, user?.email]);

  // ── Buy item ───────────────────────────────────────────────────────────────
  // Server-atomic via purchase_listing RPC (migration 025): locks the listing,
  // validates the buyer can afford it, deducts buyer coins, credits seller,
  // transfers the inventory row, marks listing completed — ALL in one
  // transaction. Replaces the old 5-step client-orchestrated sequence
  // which had two critical bugs:
  //   • Race: two buyers could both pass `status='active'` check and both
  //     receive the item (seller item duplicated).
  //   • Cheat: a tampered client could skip the deduct step and just call
  //     inventory.addItem + completeListing for a free item.
  const handleBuyConfirm = useCallback(async () => {
    if (!buyTarget || !user) return;
    setBuyBusy(true);
    try {
      await marketplace.purchaseListing(buyTarget.id);
      // Flag this listing for the warmer YOURS! sold-fade variant
      // BEFORE the next refetch removes it from the feed. The disappear
      // detector picks it up on the next render.
      const justBoughtId = buyTarget.id;
      setBoughtByMeIds(prev => {
        const next = new Set(prev);
        next.add(justBoughtId);
        return next;
      });
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      await qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      toast.success(`You bought ${buyTarget.item_emoji} ${buyTarget.item_name}!`);
      setBuyTarget(null);
    } catch (err) {
      reportError(err, { feature: 'marketplace.purchase', level: 'warning', userEmail: user?.email });
      // Map server error messages to user-friendly toasts.
      const msg = err?.message || '';
      if (/insufficient_coins/.test(msg)) {
        toast.error('Not enough Flex Coins for this purchase.');
      } else if (/item no longer available/.test(msg)) {
        toast.error('That item was already sold or is no longer available.');
        // Refresh so the buyer sees the listing is gone.
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      } else if (/listing is /.test(msg)) {
        toast.error('That listing is no longer active.');
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      } else if (/cannot purchase your own listing/.test(msg)) {
        toast.error("You can't buy your own listing.");
      } else {
        toast.error('Purchase failed: ' + (msg || 'unknown error'));
      }
    } finally {
      setBuyBusy(false);
    }
  }, [buyTarget, user, qc]);

  // In "saved" view show only the listings the viewer has wishlisted.
  // In "browse" view, exclude listings already shown inside a bundle card.
  const visibleListings = useMemo(() => {
    if (marketView === 'saved') return listings.filter(l => savedIds.has(l.id));
    return listings.filter(l => !bundledListingIds.has(l.id));
  }, [listings, savedIds, marketView, bundledListingIds]);

  return (
    <div className="flex flex-col gap-4">
      {/* Browse / Saved tab strip */}
      <div className="flex gap-1 p-1 bg-secondary/40 rounded-xl">
        {[
          { id: 'browse', label: 'Browse' },
          { id: 'saved',  label: `Saved${savedIds.size > 0 ? ` (${savedIds.size})` : ''}` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setMarketView(tab.id)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              marketView === tab.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feature 21: Rotating gradient header with sort controls */}
      <MarketplaceHeader
        flexCoins={flexCoins}
        onRefresh={() => refetch()}
        onList={() => setShowListDialog(true)}
        onOpenTradeHistory={() => navigate('/market/trades')}
        listableCount={myItems.filter(i => !i.is_listed && i.item_type === 'sticker').length}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortByChange={setSortBy}
        onSortDirToggle={() => {
          // If the user is on Recent and taps the direction toggle, they
          // expect SOMETHING to happen. Before, the button was disabled
          // (because direction has no meaning for Recent) and the tap
          // silently dropped — user reported "filter button doesn't do
          // anything." Now: auto-switch to Price + apply the requested
          // direction. One tap, useful outcome.
          if (sortBy !== 'price') {
            setSortBy('price');
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
          } else {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
          }
        }}
      />

      {/* Feature 22: Daily Chest */}
      {user && (
        <DailyChestBlock
          user={user}
          onClaimed={() => qc.invalidateQueries({ queryKey: ['userProfile', user.email] })}
        />
      )}

      {/* Buy More Capsules CTA — dark purple theme matching Marketplace Square / Daily Chest */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.01 }}
        onClick={() => setShopOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, #2d0f5a 0%, #1a0a3e 100%)',
          border: '1px solid #5b21b6',
        }}
      >
        <div className="w-10 h-10 rounded-xl bg-purple-800 border border-purple-600 flex items-center justify-center shrink-0">
          <Package className="w-5 h-5 text-purple-300" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold text-white leading-tight">Buy More Capsules</p>
          <p className="text-[11px] text-purple-200/60 leading-tight">Standard · Premium · Elite</p>
        </div>
      </motion.button>

      {/* Recently viewed rail — small thumbnails of the last 5 listings
          this user tapped into but didn't buy. Empty history renders
          nothing. Tapping a thumbnail re-opens the listing's BuyConfirm
          flow. */}
      {user?.email && (
        <RecentlyViewedRail
          userEmail={user.email}
          listings={listings}
          onSelect={(listing) => {
            // Only re-open the buy dialog for listings the viewer can
            // actually buy (their own listings or sold items just
            // dim/disable in the rail).
            if (listing.seller_email !== user.email && listing.listing_type === 'sale') {
              setBuyTarget(listing);
            } else if (listing.listing_type === 'trade') {
              setTradeTarget(listing);
            }
          }}
        />
      )}

      {/* Listings grid */}
      {loadingListings ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
        </div>
      ) : listingsError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShoppingBag className="w-12 h-12 text-gray-700" />
          <p className="text-gray-500 font-medium">Could not load listings</p>
          <button onClick={() => refetch()} className="text-purple-400 text-sm hover:underline">Try again</button>
        </div>
      ) : marketView === 'saved' && savedIds.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Heart className="w-12 h-12 text-gray-600" />
          <p className="text-gray-300 font-bold">No saved listings yet</p>
          <p className="text-gray-500 text-sm max-w-xs">
            Tap the ♥ on any listing to save it here.
          </p>
          <button
            onClick={() => setMarketView('browse')}
            className="mt-1 px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm"
          >
            Browse marketplace →
          </button>
        </div>
      ) : listings.length === 0 && recentlySold.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShoppingBag className="w-12 h-12 text-gray-700" />
          <p className="text-gray-300 font-bold">Marketplace is quiet</p>
          <p className="text-gray-500 text-sm max-w-xs">
            No one's listing right now — be the trendsetter.
          </p>
          {myItems.filter(i => !i.is_listed && i.item_type === 'sticker').length > 0 && (
            <button
              type="button"
              onClick={() => setShowListDialog(true)}
              className="mt-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm shadow-md hover:opacity-90 transition-opacity"
            >
              List the first item →
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Featured this week (mig 122) — rail rendered above the main
            grid when any listing is featured + non-expired. Quiet when
            empty so the marketplace doesn't grow a permanent header
            ribbon for nothing. */}
        {featuredListings.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-current" />
              <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-400">
                Featured this week
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {featuredListings.map(listing => (
                <ListingCard
                  key={`featured-${listing.id}`}
                  listing={listing}
                  currentUser={user}
                  flexCoins={flexCoins}
                  onBuy={(l) => { if (user?.email) addRecentlyViewed(user.email, l); setBuyTarget(l); }}
                  onCancel={handleCancel}
                  onOfferTrade={(l) => { if (user?.email) addRecentlyViewed(user.email, l); setTradeTarget(l); }}
                  soldCount={soldCountMap.get(listing.item_id) || 0}
                  onSellerClick={handleSellerClick}
                  isSaved={savedIds.has(listing.id)}
                  onToggleSave={handleToggleSave}
                />
              ))}
            </div>
          </div>
        )}
        {/* Bundle deal rows (migration 134) — shown in browse view only.
            Each bundle occupies the full grid width (col-span-full) and
            lists its member items as emoji chips before the buy button.
            Bundled items are excluded from the regular grid below. */}
        {marketView === 'browse' && activeBundles.length > 0 && activeBundles.some(b => bundleMap.has(b.id)) && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Package className="w-3.5 h-3.5 text-amber-400" />
              <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-400">Bundle deals</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <AnimatePresence>
                {activeBundles
                  .filter(b => bundleMap.has(b.id) && bundleMap.get(b.id).some(l => l.listing_type === 'sale'))
                  .map(bundle => (
                    <BundleCard
                      key={bundle.id}
                      bundle={bundle}
                      listings={bundleMap.get(bundle.id) || []}
                      currentUser={user}
                      flexCoins={flexCoins}
                      onBuyBundle={handleBuyBundle}
                    />
                  ))
                }
              </AnimatePresence>
            </div>
          </div>
        )}

        <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <AnimatePresence>
            {/* Live listings — wrap onBuy/onOfferTrade to record the
                tap in the recently-viewed log so the rail can show
                them next time. In saved-view, visibleListings is
                pre-filtered to only wishlist items. Bundled listings
                are excluded (shown in the bundle section above). */}
            {visibleListings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                currentUser={user}
                flexCoins={flexCoins}
                onBuy={(l) => { if (user?.email) addRecentlyViewed(user.email, l); setBuyTarget(l); }}
                onCancel={handleCancel}
                onOfferTrade={(l) => { if (user?.email) addRecentlyViewed(user.email, l); setTradeTarget(l); }}
                soldCount={soldCountMap.get(listing.item_id) || 0}
                onSellerClick={handleSellerClick}
                isSaved={savedIds.has(listing.id)}
                onToggleSave={handleToggleSave}
              />
            ))}
            {/* Sold-fade cards — re-render the just-removed listings
                from the previous snapshot with the SOLD overlay for
                ~5s before they collapse out. previousListingsRef is
                always one render behind, so it still contains the
                pre-sale data even when the live listings array no
                longer does. */}
            {previousListingsRef.current
              .filter(l => recentlySold.has(l.id) && !listings.find(x => x.id === l.id))
              .map(listing => (
                <ListingCard
                  key={`sold-${listing.id}`}
                  listing={listing}
                  currentUser={user}
                  flexCoins={flexCoins}
                  onBuy={() => {}}
                  onCancel={() => {}}
                  onOfferTrade={() => {}}
                  recentlySold
                  boughtByMe={boughtByMeIds.has(listing.id)}
                  soldCount={soldCountMap.get(listing.item_id) || 0}
                  onSellerClick={handleSellerClick}
                  isSaved={savedIds.has(listing.id)}
                  onToggleSave={handleToggleSave}
                />
              ))}
          </AnimatePresence>
        </motion.div>
        </>
      )}

      {/* Dialogs */}
      <AnimatePresence>
        {showListDialog && (
          <ListItemDialog
            open={showListDialog}
            onClose={() => setShowListDialog(false)}
            userItems={myItems}
            user={user}
            onSuccess={() => setShowListDialog(false)}
          />
        )}
        {tradeTarget && (
          <TradeOfferDialog
            open={!!tradeTarget}
            listing={tradeTarget}
            userItems={myItems}
            user={user}
            onClose={() => setTradeTarget(null)}
          />
        )}
        {buyTarget && (
          <BuyConfirmDialog
            open={!!buyTarget}
            listing={buyTarget}
            onClose={() => !buyBusy && setBuyTarget(null)}
            onConfirm={handleBuyConfirm}
            busy={buyBusy}
          />
        )}
      </AnimatePresence>

      {/* Coin Shop — opened via Buy More Capsules CTA */}
      <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    </div>
  );
}
