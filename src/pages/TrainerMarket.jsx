// src/pages/TrainerMarket.jsx
//
// Consumer storefront (/trainer/market) for paywalled trainer programs.
// Cards show title, description, sales count, and price. If the active
// user hasn't bought a listing, the CTA reads "Unlock for $X" and runs
// the secure checkout. Owned listings flip to "Open program."
//
// Checkout runs in MOCK mode until Stripe is configured (see
// supabase/functions/checkout-session) — a tap fulfills immediately so
// the gated-content flow is demonstrable.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Lock, CheckCircle2, Sparkles, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import { formatCents } from '@/lib/trainerSplit';
import {
  listPublishedListings, listMyPurchasedListingIds, startCheckout,
} from '@/lib/data/trainerMarket';

export default function TrainerMarket() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [buyingId, setBuyingId] = useState(null);

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['publishedTrainerListings'],
    queryFn: listPublishedListings,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const { data: ownedIds = new Set() } = useQuery({
    queryKey: ['myTrainerPurchases', user?.id],
    queryFn: () => listMyPurchasedListingIds(user.id),
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const handleUnlock = async (listing) => {
    if (buyingId) return;
    setBuyingId(listing.id);
    const res = await startCheckout(listing.id);
    setBuyingId(null);
    if (res.ok) {
      if (res.mock) {
        toast.success('Unlocked! (test mode — no charge)');
      } else {
        toast.success('Unlocked!');
      }
      qc.invalidateQueries({ queryKey: ['myTrainerPurchases', user?.id] });
      qc.invalidateQueries({ queryKey: ['publishedTrainerListings'] });
    } else {
      const map = {
        ALREADY_OWNED: 'You already own this program.',
        NOT_PUBLISHED: 'This program is no longer available.',
        CANNOT_BUY_OWN: "It's your own listing.",
        TRAINER_NOT_ONBOARDED: "This creator hasn't finished payout setup.",
        STRIPE_NOT_IMPLEMENTED: 'Live payments are coming soon.',
      };
      toast.error(map[res.error] || "Couldn't complete checkout — try again.");
      if (res.error === 'ALREADY_OWNED') {
        qc.invalidateQueries({ queryKey: ['myTrainerPurchases', user?.id] });
      }
    }
  };

  const openProgram = (listing) => {
    // Owned → the regimen is now readable (gated RLS allows it). Route
    // into the workout flow with the regimen preselected.
    if (listing.regimen_id) {
      navigate('/workout', { state: { openRegimens: true } });
    } else {
      toast.message('This program has no linked regimen yet.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto p-4 pb-24"
    >
      <button
        type="button"
        onClick={() => navigate('/market')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Market
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-primary" /> Trainer Programs
          </h1>
          <p className="text-sm text-muted-foreground">Premium regimens built by creators.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/trainer/studio')} className="gap-1.5 shrink-0">
          <Sparkles className="w-3.5 h-3.5" /> Sell
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No programs yet"
          body="When creators publish premium regimens, they'll show up here. Want to be first? Tap Sell to open your studio."
          action={{ label: 'Open creator studio', onClick: () => navigate('/trainer/studio') }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {listings.map(listing => {
            const owned = ownedIds.has(listing.id);
            const busy = buyingId === listing.id;
            return (
              <motion.div
                key={listing.id}
                whileHover={{ y: -2 }}
                className="rounded-2xl border border-border bg-card p-4 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-heading font-bold text-base leading-tight">{listing.title}</p>
                  {owned && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
                </div>
                {listing.description && (
                  <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{listing.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground mb-3">
                  {listing.sales_count > 0 ? `${listing.sales_count} sold` : 'New'}
                </p>
                <div className="mt-auto">
                  {owned ? (
                    <Button variant="outline" className="w-full gap-1.5" onClick={() => openProgram(listing)}>
                      <CheckCircle2 className="w-4 h-4" /> Open program
                    </Button>
                  ) : (
                    <Button
                      className="w-full gap-1.5 font-bold"
                      onClick={() => handleUnlock(listing)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      {busy ? 'Unlocking…' : `Unlock for ${formatCents(listing.price_cents)}`}
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
