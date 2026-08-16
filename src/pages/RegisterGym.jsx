// src/pages/RegisterGym.jsx
//
// Gym Business Owner verification form. Submits to
// submit_gym_verification (RPC, migration 135). After submission the
// owner sees a "Pending review" state until admin approval — at which
// point their Flexyn Code is generated and the gym shows up on the
// national map.
//
// Geo capture: uses browser geolocation API if the user grants it.
// Falls back to manual lat/lng entry (or skipping; admin can geocode
// from the address later before approving).

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, MapPin, Loader2, CheckCircle2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import {
  submitVerification,
  listMyVerifications,
} from '@/lib/data/gymBusinesses';
import { useLanguage } from '@/lib/LanguageContext';

const STATUS_META = {
  pending:  { color: 'text-amber-500',   label: 'Under review',  Icon: Loader2 },
  approved: { color: 'text-emerald-500', label: 'Approved',      Icon: CheckCircle2 },
  rejected: { color: 'text-destructive', label: 'Rejected',      Icon: AlertTriangle },
};

export default function RegisterGym() {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const [form, setForm] = useState({
    business_name: '',
    street_address: '',
    city: '',
    state_code: '',
    postal_code: '',
    phone: '',
    website_url: '',
    latitude: '',
    longitude: '',
  });

  useEffect(() => {
    if (!user?.id) return;
    listMyVerifications(user.id).then(rows => {
      setSubmissions(rows);
      setLoading(false);
    });
  }, [user?.id]);

  const captureLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Your browser doesn't support geolocation.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({
          ...f,
          latitude:  pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setGeoLoading(false);
        toast.success('Location captured.');
      },
      (err) => {
        setGeoLoading(false);
        toast.error(`Location failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // Synchronous in-flight guard. The local-dupe-name check at line 100
  // catches re-submits within the same mounted form, but does NOT
  // catch a within-tick double-tap where both submissions enter
  // handleSubmit before either lands on the server. The ref blocks
  // the second entry until the first either succeeds or errors out.
  const submitRef = useRef(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (submitting || submitRef.current) return;
    const name = form.business_name.trim();
    if (!name) {
      toast.error('Business name required.');
      return;
    }

    // Dedupe guard: refuse to submit if a pending row already exists
    // for the same business name (case-insensitive). Previously a
    // double-tap (or returning to the page after an earlier submit
    // and tapping again) created multiple pending rows for the same
    // gym. (Audit 12 #1.)
    const lowerName = name.toLowerCase();
    const dupe = (submissions || []).find(
      (s) => s.status === 'pending' && (s.business_name || '').trim().toLowerCase() === lowerName,
    );
    if (dupe) {
      toast.error(`"${name}" is already pending review — no need to resubmit.`);
      return;
    }

    // Strict numeric guard on lat/lng — `Number('abc')` is NaN and the
    // previous code sent NaN through to the RPC, which returned an
    // opaque error. Refuse to submit if either coord is unparseable.
    // (Audit 12 #3.)
    let lat = null, lng = null;
    if (form.latitude?.toString().trim() !== '') {
      const v = Number(form.latitude);
      if (!Number.isFinite(v) || v < -90 || v > 90) {
        toast.error('Latitude must be a number between -90 and 90.');
        return;
      }
      lat = v;
    }
    if (form.longitude?.toString().trim() !== '') {
      const v = Number(form.longitude);
      if (!Number.isFinite(v) || v < -180 || v > 180) {
        toast.error('Longitude must be a number between -180 and 180.');
        return;
      }
      lng = v;
    }

    submitRef.current = true;
    setSubmitting(true);
    const res = await submitVerification({ ...form, business_name: name, latitude: lat, longitude: lng });
    setSubmitting(false);
    submitRef.current = false;
    if (res.ok) {
      toast.success('Submitted. Flexyn will review and reach out shortly.');
      // Clear EVERY field so a subsequent submission for a different
      // gym starts from a clean slate. Previously only business_name
      // was cleared, so a user adding a second gym carried the first
      // gym's address by default — easy to send a wrong duplicate.
      setForm({
        business_name: '', street_address: '', city: '', state_code: '',
        postal_code: '', country_code: 'US', phone: '', website_url: '',
        proof_url: '', latitude: '', longitude: '',
      });
      // Refresh list
      const fresh = await listMyVerifications(user.id);
      setSubmissions(fresh);
    } else if (res.error === 'PIPELINE_MISSING') {
      toast.error('Gym registration is rolling out. Try again shortly.');
    } else {
      toast.error(`Could not submit: ${res.error || 'try again'}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> {tFallback("registerGym.home", "Home")}
      </button>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{tFallback("registerGym.registerYourGym", "Register your gym")}</h1>
          <p className="text-sm text-muted-foreground">
            Get your physical location on Flexyn. We review every submission.
          </p>
        </div>
      </div>

      {/* Existing submissions */}
      {!loading && submissions.length > 0 && (
        <div className="mt-4 mb-6 space-y-2">
          <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
            {tFallback("registerGym.yourSubmissions", "Your submissions")}
          </p>
          {submissions.map(s => {
            const meta = STATUS_META[s.status] || STATUS_META.pending;
            const Icon = meta.Icon;
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 ${meta.color} ${s.status === 'pending' ? 'animate-spin' : ''}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{s.business_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.city && `${s.city}, `}{s.state_code} · <span className={meta.color}>{meta.label}</span>
                  </p>
                  {s.status === 'rejected' && s.rejection_reason && (
                    <p className="text-xs text-destructive mt-1">{s.rejection_reason}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
            Business name *
          </label>
          <Input
            value={form.business_name}
            onChange={(e) => setForm(f => ({ ...f, business_name: e.target.value.slice(0, 80) }))}
            placeholder="e.g. Iron Forge Athletics"
            required
          />
        </div>

        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {tFallback("registerGym.streetAddress", "Street address")}
          </label>
          <Input
            value={form.street_address}
            onChange={(e) => setForm(f => ({ ...f, street_address: e.target.value }))}
            placeholder={tFallback("registerGym.123MainSt", "123 Main St")}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {tFallback("registerGym.city", "City")}
            </label>
            <Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} />
          </div>
          <div>
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {tFallback("leaderboards.region.state", "State")}
            </label>
            <Input
              value={form.state_code}
              onChange={(e) => setForm(f => ({ ...f, state_code: e.target.value.toUpperCase().slice(0, 2) }))}
              placeholder="CA"
              maxLength={2}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
              ZIP / Postal
            </label>
            <Input
              value={form.postal_code}
              onChange={(e) => setForm(f => ({ ...f, postal_code: e.target.value.slice(0, 10) }))}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {tFallback("gymEdit.phone", "Phone")}
            </label>
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value.slice(0, 20) }))}
              inputMode="tel"
            />
          </div>
        </div>

        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {tFallback("gymEdit.website", "Website")}
          </label>
          <Input
            type="url"
            value={form.website_url}
            onChange={(e) => setForm(f => ({ ...f, website_url: e.target.value.slice(0, 200) }))}
            placeholder="https://"
          />
        </div>

        {/* Location capture */}
        <div className="rounded-xl border border-dashed border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
              {tFallback("registerGym.pinLocation", "Pin location")}
            </p>
            <button
              type="button"
              onClick={captureLocation}
              disabled={geoLoading}
              className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 px-2 py-1 rounded"
            >
              {geoLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <MapPin className="w-3 h-3" />}
              Use my location
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={form.latitude}
              onChange={(e) => setForm(f => ({ ...f, latitude: e.target.value }))}
              placeholder={tFallback("registerGym.latitude", "Latitude")}
            />
            <Input
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={form.longitude}
              onChange={(e) => setForm(f => ({ ...f, longitude: e.target.value }))}
              placeholder={tFallback("registerGym.longitude", "Longitude")}
            />
          </div>
          <p className="text-micro text-muted-foreground mt-1.5">
            Stand inside your gym + tap "Use my location" for the most accurate pin.
            Or leave blank — we can geocode from the address.
          </p>
        </div>

        <Button type="submit" disabled={submitting} className="w-full h-11 font-bold">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
          {submitting ? 'Submitting…' : 'Submit for review'}
        </Button>
        <p className="text-micro text-muted-foreground text-center">
          Approval typically takes 1–2 business days. We'll email you when your Flexyn Code is ready.
        </p>
      </form>

      {loading && submissions.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={Building2}
            title={tFallback("registerGym.noSubmissionsYet", "No submissions yet")}
            body="Fill out the form above to register your gym."
          />
        </div>
      )}
    </motion.div>
  );
}
