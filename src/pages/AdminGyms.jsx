// src/pages/AdminGyms.jsx
//
// Admin-only dashboard for reviewing pending gym business
// verification submissions. Lists every pending row from
// gym_verification_queue, lets the admin approve (which mints the
// Flexyn Code + creates the gym_businesses row via the RPC) or
// reject with a reason.
//
// Access control: gated client-side via isAppAdmin() on the user's
// username + the RPC's own admin check (defense in depth). A
// non-admin who navigates here sees a "not authorized" empty state.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, Phone, Globe, Check, X,
  Loader2, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminRoles';
import EmptyState from '@/components/EmptyState';
import { safeExternalUrl } from '@/lib/safeUrl';
import {
  listPendingVerifications,
  approveVerification,
  rejectVerification,
} from '@/lib/data/gymBusinesses';

export default function AdminGyms() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = isAppAdmin(user);

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Synchronous double-tap guards on the two destructive admin actions.
  // `actingId` is React state (async). A fast double-tap before the
  // next render fires the RPC twice — approve produced raw 23505 on
  // the second call (UNIQUE on verification_id) instead of a friendly
  // toast; reject silently overwrote any concurrent approve. Wave 56
  // (AdminGyms audit) caught this. Mig 158's status='pending' guard
  // is the authoritative server-side bar; the ref makes the UX clean.
  // Declared BEFORE the non-admin early return to keep hook-order stable.
  const approveBusyRef = useRef(false);
  const rejectBusyRef = useRef(false);

  const refresh = async () => {
    setLoading(true);
    setPending(await listPendingVerifications());
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) refresh();
    else setLoading(false);
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState
          icon={AlertTriangle}
          title="Not authorized"
          body="This page is for Flexyn admins only."
        />
      </div>
    );
  }

  const handleApprove = async (v) => {
    if (actingId || approveBusyRef.current) return;
    approveBusyRef.current = true;
    setActingId(v.id);
    const res = await approveVerification(v.id);
    setActingId(null);
    approveBusyRef.current = false;
    if (res.ok) {
      toast.success(`Approved — Flexyn Code generated.`);
      refresh();
    } else {
      toast.error(`Approve failed: ${res.error || 'try again'}`);
    }
  };

  const handleStartReject = (v) => {
    setRejectingId(v.id);
    setRejectReason('');
  };

  const handleConfirmReject = async (v) => {
    if (actingId || rejectBusyRef.current) return;
    rejectBusyRef.current = true;
    // Trim the reason so whitespace-only doesn't land as a literal
    // "   " in the DB and confuse the submitter into thinking no
    // reason was given. (Audit 12 #5.)
    const reason = (rejectReason || '').trim() || null;
    setActingId(v.id);
    const res = await rejectVerification(v.id, reason);
    setActingId(null);
    rejectBusyRef.current = false;
    if (res.ok) {
      toast.success('Rejected.');
      setRejectingId(null);
      refresh();
    } else {
      toast.error('Reject failed.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Gym verifications</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length} pending submission{pending.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No pending submissions"
          body="New verification requests will appear here."
        />
      ) : (
        <div className="space-y-3">
          {pending.map(v => {
            const acting = actingId === v.id;
            const rejecting = rejectingId === v.id;
            const hasGeo = v.latitude != null && v.longitude != null;
            return (
              <div key={v.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold text-base">{v.business_name}</h3>
                    <p className="text-xs text-muted-foreground">
                      Submitted {format(parseISO(v.created_at), "MMM d 'at' h:mm a")} by {v.owner_email}
                    </p>
                  </div>
                </div>

                <dl className="text-xs space-y-1 mt-3">
                  {(v.street_address || v.city) && (
                    <div className="flex gap-2">
                      <MapPin className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                      <span>
                        {[v.street_address, v.city, v.state_code, v.postal_code]
                          .filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
                  {v.phone && (
                    <div className="flex gap-2">
                      <Phone className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                      <span>{v.phone}</span>
                    </div>
                  )}
                  {v.website_url && safeExternalUrl(v.website_url) && (
                    <div className="flex gap-2">
                      <Globe className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                      <a
                        href={safeExternalUrl(v.website_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {v.website_url}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  )}
                </dl>

                {!hasGeo && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-600 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      No lat/lng provided. The gym will be approved but won't appear on the
                      discovery map until the owner sets coordinates from Edit Gym.
                    </span>
                  </div>
                )}
                {hasGeo && (
                  <p className="mt-2 text-micro text-muted-foreground font-mono">
                    📍 {Number(v.latitude).toFixed(4)}, {Number(v.longitude).toFixed(4)}
                  </p>
                )}

                {rejecting && (
                  <div className="mt-3">
                    <Input
                      placeholder="Reason (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value.slice(0, 200))}
                    />
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  {!rejecting ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartReject(v)}
                        disabled={acting}
                        className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10 active:bg-destructive/10"
                      >
                        <X className="w-4 h-4 me-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleApprove(v)}
                        disabled={acting}
                        className="flex-1"
                      >
                        {acting
                          ? <Loader2 className="w-4 h-4 animate-spin me-1" />
                          : <Check className="w-4 h-4 me-1" />}
                        Approve
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRejectingId(null)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleConfirmReject(v)}
                        disabled={acting}
                        className="flex-1"
                      >
                        {acting && <Loader2 className="w-4 h-4 animate-spin me-1" />}
                        Confirm reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
