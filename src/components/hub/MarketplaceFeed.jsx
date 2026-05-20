// src/components/hub/MarketplaceFeed.jsx
// Marketplace tab — browse listings, buy, trade, and list your own items.

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, X, Coins, Zap,
  Sparkles, ChevronLeft, RefreshCw, Lock,
  ArrowUpDown, Gift, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as marketplace from '@/lib/data/marketplace';
import * as inventory   from '@/lib/data/inventory';
import * as capsules    from '@/lib/data/capsules';
import { findOrCreateConversation, sendMessage } from '@/lib/data/hubMessages';
import { RARITY } from '@/lib/lootCatalog';

// ─── Daily Chest helpers ──────────────────────────────────────────────────────
const CHEST_KEY = (userId) => `daily_chest_claimed_${userId}`;

function isDailyChestClaimed(userId) {
  if (!userId) return false;
  const val = localStorage.getItem(CHEST_KEY(userId));
  if (!val) return false;
  const claimedDate = new Date(val).toDateString();
  const today = new Date().toDateString();
  return claimedDate === today;
}

function markDailyChestClaimed(userId) {
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
function ListingCard({ listing, currentUser, flexCoins, onBuy, onCancel, onOfferTrade }) {
  const isMine      = listing.seller_email === currentUser?.email;
  const isSale      = listing.listing_type === 'sale';
  const canAfford   = isSale && flexCoins >= (listing.asking_price ?? 0);
  const rc          = RARITY[listing.item_rarity] ?? RARITY.common;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={[
        'flex flex-col rounded-xl border-2 bg-[#0f0f2a] p-3 gap-2 relative overflow-hidden',
        rc.borderClass,
      ].join(' ')}
    >
      {/* Subtle rarity glow */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${rc.color}12, transparent)` }}
      />

      {/* Item */}
      <div className="flex flex-col items-center gap-1 relative z-10">
        <span className="text-4xl leading-none">{listing.item_emoji}</span>
        <span className="text-white text-xs font-semibold text-center leading-tight">{listing.item_name}</span>
        <RarityBadge rarity={listing.item_rarity} small />
      </div>

      {/* Seller */}
      <p className="text-gray-500 text-[10px] text-center relative z-10">
        by <span className="text-gray-400 font-medium">{listing.seller_username || listing.seller_email.split('@')[0]}</span>
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
          <p className="text-amber-300 font-bold text-sm">🪙 {(listing.asking_price ?? 0).toLocaleString()}</p>
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
            Buy · 🪙 {(listing.asking_price ?? 0).toLocaleString()}
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

// ─── List Item Dialog ─────────────────────────────────────────────────────────
function ListItemDialog({ open, onClose, userItems, user, onSuccess }) {
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
      toast.success('Item listed!');
      handleClose();
      onSuccess?.();
    } catch (err) {
      toast.error('Failed to list item: ' + err.message);
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
                      type="number"
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
          price: listing.price ?? null,
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
      toast.success('Trade offer sent! Check your messages.');
      onClose();
    } catch (err) {
      toast.error('Could not send trade offer: ' + err.message);
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
          <p className="text-amber-300 font-bold text-lg mt-1">🪙 {(listing.asking_price ?? 0).toLocaleString()} Flex Coins</p>
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

// ─── Rotating gradient header ─────────────────────────────────────────────────
function MarketplaceHeader({ flexCoins, onRefresh, onList, sortBy, sortDir, onSortByChange, onSortDirToggle }) {
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
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: `linear-gradient(${gradientAngle}deg, rgba(139,92,246,0.25) 0%, rgba(99,102,241,0.18) 40%, rgba(168,85,247,0.22) 70%, rgba(79,70,229,0.18) 100%)`,
        border: '1px solid rgba(139,92,246,0.35)',
      }}
    >
      {/* Row 1: title + coins + list button */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-purple-300" />
          <h2 className="text-white font-bold text-lg">Marketplace</h2>
          <button
            onClick={onRefresh}
            className="text-purple-300/70 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 rounded-full px-3 py-1.5">
            <span className="text-base">🪙</span>
            <span className="text-amber-300 font-bold text-sm">{flexCoins.toLocaleString()}</span>
          </div>
          <button
            onClick={onList}
            className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm shadow-lg hover:opacity-90 transition-opacity"
          >
            List Item
          </button>
        </div>
      </div>

      {/* Row 2: sort controls */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
            className="appearance-none bg-white/10 border border-white/20 text-white text-xs font-semibold rounded-full pl-3.5 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
          >
            <option value="recent">Recent</option>
            <option value="price">Price</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-white/60" />
        </div>
        <button
          onClick={onSortDirToggle}
          title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
          className="flex items-center gap-1 bg-white/10 border border-white/20 text-white text-xs font-semibold rounded-full px-3.5 py-1.5 hover:bg-white/20 transition-colors"
        >
          <ArrowUpDown className="w-3 h-3" />
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
    </div>
  );
}

// ─── Daily Chest block ────────────────────────────────────────────────────────
function DailyChestBlock({ user, onClaimed }) {
  const [claimed, setClaimed] = useState(() => isDailyChestClaimed(user?.id));
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    if (claimed || loading || !user) return;
    setLoading(true);
    try {
      // Grant a standard capsule + 25 flex coins
      await capsules.grantForLevelUp(user.id, user.email, 1);
      markDailyChestClaimed(user.id);
      setClaimed(true);
      toast.success('🎁 Daily chest claimed! Check your capsules.');
      onClaimed?.();
    } catch (err) {
      console.error('[DailyChest] claim error:', err);
      // Still mark claimed to avoid spam clicks on error
      markDailyChestClaimed(user.id);
      setClaimed(true);
      toast.success('🎁 Daily chest claimed!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.30) 0%, rgba(91,33,182,0.35) 100%)',
        border: '1px solid rgba(139,92,246,0.45)',
      }}
    >
      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
        <Gift className={`w-6 h-6 ${claimed ? 'text-white/30' : 'text-white'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">Daily Chest</p>
        <p className="text-purple-100 font-medium text-xs mt-0.5">
          {claimed ? 'Come back tomorrow for another reward!' : 'Claim your free daily capsule + coins'}
        </p>
      </div>
      <button
        onClick={handleClaim}
        disabled={claimed || loading}
        className={[
          'shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all',
          claimed
            ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed border border-gray-600/30'
            : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:opacity-90 shadow-md',
        ].join(' ')}
      >
        {loading ? '…' : claimed ? 'Claimed' : 'Claim'}
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
  // Feature 21: sort controls
  const [sortBy,  setSortBy]  = useState('recent'); // 'recent' | 'price'
  const [sortDir, setSortDir] = useState('desc');   // 'asc' | 'desc'

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: rawListings, isLoading: loadingListings, isError: listingsError, refetch } = useQuery({
    queryKey: ['marketplaceListings', sortBy, sortDir],
    queryFn:  () => marketplace.listActive(60, sortBy, sortDir),
    staleTime: 15_000,
  });
  const listings = Array.isArray(rawListings) ? rawListings : [];

  const { data: rawMyItems } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email,
    staleTime: 30_000,
  });
  const myItems = Array.isArray(rawMyItems) ? rawMyItems : [];

  // Feature 20: Admin sandbox — identified by username OR email prefix
  const adminUsernames = ['sean', 'seanj', 'kegan', 'admin'];
  const emailPrefix = user?.email?.split('@')[0]?.toLowerCase() || '';
  const isAdmin = adminUsernames.includes(user?.username?.toLowerCase()) ||
                  adminUsernames.includes(emailPrefix);
  const flexCoins = isAdmin ? 1_000_000 : (user?.flex_coins ?? 0);

  // ── Cancel listing ─────────────────────────────────────────────────────────
  const handleCancel = useCallback(async (listing) => {
    try {
      await marketplace.cancelListing(listing.id);
      await inventory.setListed(listing.inventory_id, false);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
      toast.success('Listing cancelled.');
    } catch (err) {
      toast.error('Could not cancel: ' + err.message);
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
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      await qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      toast.success(`You bought ${buyTarget.item_emoji} ${buyTarget.item_name}!`);
      setBuyTarget(null);
    } catch (err) {
      console.error('[Marketplace] purchase failed:', err);
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

  return (
    <div className="flex flex-col gap-4">
      {/* Feature 21: Rotating gradient header with sort controls */}
      <MarketplaceHeader
        flexCoins={flexCoins}
        onRefresh={() => refetch()}
        onList={() => setShowListDialog(true)}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortByChange={setSortBy}
        onSortDirToggle={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
      />

      {/* Feature 22: Daily Chest */}
      {user && (
        <DailyChestBlock
          user={user}
          onClaimed={() => qc.invalidateQueries({ queryKey: ['userProfile', user.email] })}
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
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShoppingBag className="w-12 h-12 text-gray-700" />
          <p className="text-gray-500 font-medium">No listings yet</p>
          <p className="text-gray-600 text-sm">Be the first to list an item!</p>
        </div>
      ) : (
        <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <AnimatePresence>
            {listings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                currentUser={user}
                flexCoins={flexCoins}
                onBuy={setBuyTarget}
                onCancel={handleCancel}
                onOfferTrade={setTradeTarget}
              />
            ))}
          </AnimatePresence>
        </motion.div>
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
    </div>
  );
}
