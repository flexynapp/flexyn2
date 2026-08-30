// src/pages/TrainerStudio.jsx
//
// Trainer Content Studio (/trainer/studio). Where a trainer packages
// existing regimens into paywalled listings, tracks revenue, and
// manages publish state + Stripe Connect onboarding status.
//
// Payments run in MOCK mode until Stripe is configured (see
// supabase/functions/checkout-session). The Connect status row below
// reflects whether the trainer has linked a payout account.

import React, { lazy, Suspense, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Loader2, DollarSign, Eye, EyeOff, Trash2, Pencil,
  TrendingUp, CreditCard, CheckCircle2, AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import EmptyState from '@/components/EmptyState';
import ErrorBoundary from '@/components/ErrorBoundary';
import { formatCents, calculateSplit } from '@/lib/trainerSplit';
import {
  getMyListings, getMyRevenue, setPublished, deleteListing, becomeTrainer,
} from '@/lib/data/trainerMarket';
import { useLanguage } from '@/lib/LanguageContext';

const ListingFormModal = lazy(() => import('@/components/trainer/ListingFormModal'));

export default function TrainerStudio() {
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(null);

  const { data: profile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const isTrainer = !!profile?.is_trainer;
  const connectLinked = !!profile?.stripe_connect_id;

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['trainerListings', user?.id],
    queryFn: () => getMyListings(user.id),
    enabled: !!user?.id && isTrainer,
    staleTime: 30_000,
  });

  const { data: revenue = { gross_cents: 0, payout_cents: 0, fee_cents: 0, sales: 0 } } = useQuery({
    queryKey: ['trainerRevenue', user?.id],
    queryFn: getMyRevenue,
    enabled: !!user?.id && isTrainer,
    staleTime: 30_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['trainerListings', user?.id] });
    qc.invalidateQueries({ queryKey: ['trainerRevenue', user?.id] });
  };

  const handleBecomeTrainer = async () => {
    const res = await becomeTrainer();
    if (res.ok) {
      toast.success(tFallback('trainerStudio.creatorEnabled', 'Creator mode enabled. Build your first listing.'));
      qc.invalidateQueries({ queryKey: ['userProfile', user?.email] });
    } else {
      toast.error(tFallback('trainerStudio.creatorEnableFailed', 'Could not enable creator mode. Try again.'));
    }
  };

  // Synchronous in-flight guards keyed by listing id. Without them a
  // fast double-tap on Publish or Delete fires the RPC twice — Publish
  // can race-flip back to the original state, Delete can fire two
  // delete attempts and the second errors with 23503 because the row
  // is gone. Set of ids currently in-flight; checked + mutated within
  // the click handler before any async work.
  const publishInFlight = useRef(new Set());
  const deleteInFlight = useRef(new Set());

  const handleTogglePublish = async (listing) => {
    if (publishInFlight.current.has(listing.id)) return;
    publishInFlight.current.add(listing.id);
    const res = await setPublished(listing.id, !listing.is_published);
    publishInFlight.current.delete(listing.id);
    if (res.ok) {
      toast.success(listing.is_published
        ? tFallback('trainerStudio.unpublished', 'Unpublished.')
        : tFallback('trainerStudio.published', 'Published to market.'));
      refresh();
    } else {
      toast.error(res.error || tFallback('trainerStudio.updateFailed', "Couldn't update."));
    }
  };

  const handleDelete = async (listing) => {
    // Refuse to delete a listing that has sales. Buyers' regimen-access
    // policy joins trainer_purchases.listing_id → trainer_listings.id; once
    // the listing row is gone the join fails and buyers lose access to
    // the program they paid for. The right path for a trainer who wants
    // to stop selling is Unpublish (sets is_published=false, keeps the
    // row + buyer access intact). After mig 147 lands the listing_id FK
    // is ON DELETE SET NULL so the purchase row survives the delete,
    // but the access lookup still breaks — so we still block here.
    if ((listing.sales_count ?? 0) > 0) {
      toast.error(tFallback(
        'trainerStudio.hasBuyers',
        'This program has buyers. Unpublish it instead, because deleting would revoke their access.',
      ));
      return;
    }
    if (deleteInFlight.current.has(listing.id)) return;
    if (!confirm(tFallback(
      'trainerStudio.confirmDelete',
      'Delete "{title}"? This program has no buyers, so removing it is safe.',
      { title: listing.title },
    ))) return;
    deleteInFlight.current.add(listing.id);
    const res = await deleteListing(listing.id);
    deleteInFlight.current.delete(listing.id);
    if (res.ok) { toast.success(tFallback('trainerStudio.listingDeleted', 'Listing deleted.')); refresh(); }
    else toast.error(res.error || tFallback('trainerStudio.deleteFailed', 'Could not delete.'));
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
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> {tFallback("trainerStudio.market", "Market")}
      </button>

      <div className="mb-4">
        <h1 className="font-heading text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> {tFallback("app.creatorStudio", "Creator Studio")}
        </h1>
        <p className="text-sm text-muted-foreground">{tFallback('trainerStudio.subtitle', 'Package your regimens into premium programs.')}</p>
      </div>

      {!isTrainer ? (
        <>
          <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-foreground/80">
              <span className="font-bold text-amber-600">{tFallback("formcoach.beta", "Beta")}</span>
              {' · '}
              {tFallback(
                'trainerStudio.betaNote',
                'Creator mode is rolling out. The storefront, payouts and review tools come online over the next few weeks.',
              )}
            </p>
          </div>
          <EmptyState
            icon={Sparkles}
            title={tFallback("trainerStudio.becomeACreator", "Become a creator")}
            body={tFallback(
              'trainerStudio.becomeBody',
              'Turn your best regimens into paid programs. Flexyn handles checkout and takes a {fee}% platform fee, so you keep {keep}%.',
              { fee: 15, keep: 85 },
            )}
            action={{
              label: tFallback('trainerStudio.enableCreatorMode', 'Enable creator mode'),
              onClick: handleBecomeTrainer,
            }}
          />
        </>
      ) : (
        <ErrorBoundary label="TrainerStudio.body">
          {/* Revenue summary */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { id: 'payout', label: 'Your payout', value: formatCents(revenue.payout_cents), color: 'text-emerald-500', Icon: TrendingUp },
              { id: 'gross',  label: 'Gross sales', value: formatCents(revenue.gross_cents), color: 'text-foreground', Icon: DollarSign },
              { id: 'sales',  label: 'Sales',       value: String(revenue.sales),            color: 'text-primary',   Icon: CheckCircle2 },
            ].map(({ id, label, value, color, Icon }) => (
              <div key={id} className="rounded-2xl border border-border bg-card p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                <p className={`font-heading font-bold text-lg tabular-nums ${color}`}>{value}</p>
                <p className="text-micro text-muted-foreground uppercase tracking-wide">{tFallback(`trainerStudio.stat.${id}`, label)}</p>
              </div>
            ))}
          </div>

          {/* Stripe Connect status */}
          <div className={`rounded-2xl border p-3 mb-4 flex items-center gap-3 ${
            connectLinked ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'
          }`}>
            <CreditCard className={`w-5 h-5 shrink-0 ${connectLinked ? 'text-emerald-500' : 'text-amber-500'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {connectLinked ? 'Payout account linked' : 'Payouts not set up yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {connectLinked
                  ? 'Real payouts route to your Stripe account once live.'
                  : 'Checkout runs in test mode until Stripe Connect is configured. Sales still record so you can preview the flow.'}
              </p>
            </div>
            {!connectLinked && (
              <span className="text-micro font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 shrink-0">
                {tFallback("trainerStudio.testMode", "Test mode")}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-bold">{tFallback("trainerStudio.yourListings", "Your listings")}</h2>
            <Button size="sm" onClick={() => { setEditingListing(null); setFormOpen(true); }} className="gap-1.5">
              <Plus className="w-4 h-4" /> {tFallback("trainerStudio.newListing", "New listing")}
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : listings.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title={tFallback("trainerStudio.noListingsYet", "No listings yet")}
              body={tFallback(
                'trainerStudio.noListingsBody',
                'Create your first premium program. Pick a regimen, set a price, and publish.',
              )}
              action={{
                label: tFallback('trainerStudio.newListing', 'New listing'),
                onClick: () => { setEditingListing(null); setFormOpen(true); },
              }}
            />
          ) : (
            <div className="space-y-2">
              {listings.map(listing => {
                const split = calculateSplit(listing.price_cents);
                return (
                  <div key={listing.id} className="rounded-2xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-heading font-bold text-sm truncate">{listing.title}</p>
                          {listing.is_published ? (
                            <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 shrink-0">{tFallback("trainerStudio.live", "Live")}</span>
                          ) : (
                            <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">{tFallback("trainerStudio.draft", "Draft")}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatCents(listing.price_cents)} · you keep {formatCents(split.trainerPayoutCents)} · {listing.sales_count} sold
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(listing)}
                          className="w-8 h-8 rounded-full hover:bg-secondary active:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground"
                          aria-label={listing.is_published ? 'Unpublish' : 'Publish'}
                          title={listing.is_published ? 'Unpublish' : 'Publish to market'}
                        >
                          {listing.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingListing(listing); setFormOpen(true); }}
                          className="w-8 h-8 rounded-full hover:bg-secondary active:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground"
                          aria-label={tFallback("coach.plan.edit", "Edit")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(listing)}
                          className="w-8 h-8 rounded-full hover:bg-destructive/10 active:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive active:text-destructive"
                          aria-label={tFallback("common.delete", "Delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {!listing.regimen_id && (
                      <p className="text-micro text-amber-600 flex items-center gap-1 mt-2">
                        <AlertCircle className="w-3 h-3" /> No regimen linked — buyers won't unlock any content.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ErrorBoundary>
      )}

      {formOpen && (
        <ErrorBoundary label="ListingFormModal">
          <Suspense fallback={null}>
            <ListingFormModal
              open={formOpen}
              onClose={() => { setFormOpen(false); setEditingListing(null); }}
              listing={editingListing}
              trainerId={user?.id}
              userEmail={user?.email}
              onSaved={() => { setFormOpen(false); setEditingListing(null); refresh(); }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </motion.div>
  );
}
