// src/components/trainer/ListingFormModal.jsx
//
// Create / edit a trainer listing. Pick one of the trainer's existing
// regimens, set a price, write a description. Shows the 15/85 split
// preview live as the price changes.

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/toast';
import { db } from '@/api/db';
import { calculateSplit, formatCents, dollarsToCents } from '@/lib/trainerSplit';
import { createListing, updateListing } from '@/lib/data/trainerMarket';

export default function ListingFormModal({ open, onClose, listing, trainerId, userEmail, onSaved }) {
  const editing = !!listing;
  const [title, setTitle] = useState(listing?.title || '');
  const [description, setDescription] = useState(listing?.description || '');
  const [priceInput, setPriceInput] = useState(
    listing?.price_cents != null ? (listing.price_cents / 100).toFixed(2) : ''
  );
  const [regimenId, setRegimenId] = useState(listing?.regimen_id || '');
  const [saving, setSaving] = useState(false);
  // Synchronous double-tap guard — `saving` state lags React, so a fast
  // second tap in the same tick fires createListing/updateListing
  // twice. In live (non-mock) Stripe mode the duplicate row is real
  // money. Pattern: useRef + early-return in the click handler.
  const savingRef = useRef(false);

  const { data: regimens = [] } = useQuery({
    queryKey: ['regimens', userEmail],
    queryFn: () => db.entities.Regimen.filter({ created_by: userEmail }),
    enabled: !!userEmail,
  });

  const priceCents = dollarsToCents(priceInput);
  const split = calculateSplit(priceCents);
  const priceValid = priceCents >= 100;

  const handleSave = async () => {
    if (saving || savingRef.current) return;
    if (!title.trim()) { toast.error('Add a title.'); return; }
    if (!priceValid) { toast.error('Minimum price is $1.00.'); return; }
    savingRef.current = true;
    setSaving(true);
    const res = editing
      ? await updateListing(listing.id, { title, description, priceCents, regimenId })
      : await createListing({ trainerId, regimenId, title, description, priceCents });
    setSaving(false);
    savingRef.current = false;
    if (res.ok) {
      toast.success(editing ? 'Listing updated.' : 'Listing created — publish it when ready.');
      onSaved?.();
    } else if (res.error === 'PRICE_TOO_LOW') {
      toast.error('Minimum price is $1.00.');
    } else if (res.error === 'PIPELINE_MISSING') {
      toast.error('Creator features are rolling out — try again shortly.');
    } else {
      toast.error(res.error || "Couldn't save listing.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-bold text-lg">{editing ? 'Edit listing' : 'New listing'}</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-secondary active:bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Regimen</label>
            <select
              value={regimenId}
              onChange={(e) => setRegimenId(e.target.value)}
              className="w-full mt-1 h-10 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— Select a regimen to sell —</option>
              {regimens.map(r => (
                <option key={r.id} value={r.id}>{r.name || 'Untitled regimen'}</option>
              ))}
            </select>
            {!regimenId && (
              <p className="text-micro text-amber-600 mt-1">
                Buyers unlock the linked regimen on purchase. Without one, the listing sells nothing.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              placeholder="12-Week Hypertrophy Block"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
              placeholder="What's inside, who it's for, expected results…"
              rows={3}
              className="mt-1 resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price (USD)</label>
            <div className="relative mt-1">
              <DollarSign className="w-4 h-4 text-muted-foreground absolute start-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                inputMode="decimal"
                placeholder="19.99"
                className="ps-8"
              />
            </div>
            {priceInput && (
              <div className="mt-2 rounded-lg bg-secondary/40 border border-border p-2.5 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">List price</span>
                  <span className="font-semibold tabular-nums">{formatCents(priceCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platform fee (15%)</span>
                  <span className="tabular-nums text-muted-foreground">−{formatCents(split.platformFeeCents)}</span>
                </div>
                <div className="flex justify-between border-t border-border/60 pt-1">
                  <span className="font-semibold text-emerald-600">You keep</span>
                  <span className="font-bold tabular-nums text-emerald-600">{formatCents(split.trainerPayoutCents)}</span>
                </div>
                {!priceValid && <p className="text-micro text-destructive">Minimum is $1.00.</p>}
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={saving || !title.trim() || !priceValid} className="w-full gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {editing ? 'Save changes' : 'Create listing'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
