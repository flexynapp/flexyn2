// src/pages/GymEdit.jsx
//
// Owner-only edit screen for a gym's customizable fields. Logo, cover,
// description, phone, website, geo coords. The Flexyn Code itself is
// immutable — once printed and distributed, changing it would invalidate
// every poster the owner has hung.
//
// Storage: avatar + cover images upload to the existing Supabase Storage
// "avatars" bucket (reusing the pattern Hub avatar uploads use). Reusing
// one bucket is fine — RLS gates writes to the uploading user only.

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Building2, Clock, Loader2, MapPin, Save, Upload, X, Image as ImageIcon } from 'lucide-react';
import { AMENITY_META, AMENITY_SLUGS } from '@/lib/gymAmenities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import EmptyState from '@/components/EmptyState';
import { getGym } from '@/lib/data/gymBusinesses';
import GymEquipmentEditor from '@/components/gyms/GymEquipmentEditor';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';

export default function GymEdit() {
  const { tFallback } = useLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [gym, setGym] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    logo_url: '',
    cover_url: '',
    phone: '',
    website_url: '',
    latitude: '',
    longitude: '',
    // mig 140 fields
    hours: {},        // { mon: { open: '06:00', close: '22:00' }, ... }
    amenities: [],    // ['parking', 'showers', ...]
    photo_urls: [],   // array of public URLs
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getGym(id).then(g => {
      setGym(g);
      if (g) {
        setForm({
          name:        g.name || '',
          description: g.description || '',
          logo_url:    g.logo_url || '',
          cover_url:   g.cover_url || '',
          phone:       g.phone || '',
          website_url: g.website_url || '',
          latitude:    g.latitude  != null ? String(g.latitude)  : '',
          longitude:   g.longitude != null ? String(g.longitude) : '',
          hours:       g.hours      && typeof g.hours === 'object' ? g.hours : {},
          amenities:   Array.isArray(g.amenities)  ? g.amenities  : [],
          photo_urls:  Array.isArray(g.photo_urls) ? g.photo_urls : [],
        });
      }
      setLoading(false);
    });
  }, [id]);

  const isOwner = !!(gym && user?.id && gym.owner_id === user.id);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!gym) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState icon={Building2} title={tFallback("gymEdit.gymNotFound", "Gym not found")} body="That gym ID doesn't exist." />
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState icon={Building2} title={tFallback("gymEdit.notAuthorized", "Not authorized")} body="Only the gym owner can edit this page." />
      </div>
    );
  }

  // Image upload helper — shared by logo + cover. Uploads to the
  // `uploads` bucket under <uid>/gym/<gymId>/<kind>-<timestamp>.<ext>.
  //
  // This used to target an "avatars" bucket that has never existed (the
  // name came from migration comments in 140/145), so every gym logo and
  // cover upload failed. The uid has to lead the path regardless of how
  // we'd prefer to namespace these: the bucket's INSERT policy is
  // `foldername(name)[1] = auth.uid()`, so a gym-first prefix is rejected
  // by RLS. The gym id still namespaces the assets, one level down.
  const uploadImage = async (file, kind) => {
    if (!file || !user?.id) return null;
    // Hard cap at 5 MB so a 12 MB phone photo doesn't get served
    // unscaled to every visiting gym member. The Supabase Storage
    // bucket default may be higher; this is the user-friendly limit.
    // (Audit 12 #32.)
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast.error(tFallback('gymEdit.imageTooLarge', 'Image too large. Keep it under {n} MB.', { n: 5 }));
      return null;
    }
    // Whitelist image extensions. Without this an upload of `evil.html`
    // landed at `gym/<id>/<kind>-<ts>.html` with `contentType: 'text/html'`
    // (via file.type passthrough), served from the public bucket as
    // executable HTML — XSS vector against any anon viewer. Wave 56
    // (GymEdit audit) caught this.
    const SAFE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
    const SAFE_MIMES = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', heic: 'image/heic',
    };
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    if (!SAFE_EXTS.includes(ext)) {
      toast.error(tFallback('gymEdit.imageTypeUnsupported', 'Image type not supported. Use JPG, PNG, WebP, or HEIC.'));
      return null;
    }
    const path = `${user.id}/gym/${gym.id}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('uploads')
      // Pin contentType to the safe MIME derived from the extension,
      // NOT the client-supplied file.type — which a tampered client
      // can lie about.
      // upsert:false — see stories.js / db.js: an upsert needs a SELECT policy
      // on storage.objects, and the path is already unique (ms timestamp).
      .upload(path, file, { upsert: false, contentType: SAFE_MIMES[ext] });
    if (error) {
      reportError(error, { feature: 'gym.photo-upload' });
      toast.error(tFallback('notice.photoUploadFailed', "Couldn't upload the photo. Try again."));
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);
    return publicUrl;
  };

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    const url = await uploadImage(file, 'logo');
    setUploadingLogo(false);
    if (url) setForm(f => ({ ...f, logo_url: url }));
  };

  const handleCoverPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingCover(true);
    const url = await uploadImage(file, 'cover');
    setUploadingCover(false);
    if (url) setForm(f => ({ ...f, cover_url: url }));
  };

  const captureLocation = () => {
    if (!navigator.geolocation) { toast.error(tFallback('gymEdit.geoUnsupported', 'Geolocation not supported.')); return; }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({
          ...f,
          latitude:  pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setGeoLoading(false);
        toast.success(tFallback('gymEdit.locationCaptured', 'Location captured.'));
      },
      (err) => { setGeoLoading(false); toast.error(err.message); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleSave = async () => {
    if (saving) return;
    // Block save while any image upload is in flight. Without this,
    // a user who picks a new logo and immediately hits Save before
    // the upload finishes saves with the OLD logo_url, then the
    // in-flight upload's setForm callback lands AFTER navigation —
    // the new logo URL is orphaned in storage and never persisted.
    // Wave 56 (GymEdit audit) caught this.
    if (uploadingPhoto || uploadingLogo || uploadingCover) {
      toast.error(tFallback('gymEdit.waitForUpload', 'Wait for the image upload to finish.'));
      return;
    }
    if (!form.name.trim()) { toast.error(tFallback('gymEdit.nameRequired', 'Name required.')); return; }
    // Lat/lng are OPTIONAL. After mig 150 these columns are nullable
    // on gym_businesses, so gyms without coords can still save changes
    // (hours, description, photos). Previously the form blocked ALL
    // saves until the user entered valid coords — even unrelated
    // fields like the description couldn't be edited. (Audit 12 #30.)
    //
    // Still validates: if the user TYPED something, it must be numeric
    // and in-range — refuse to save partial garbage. Blank inputs save
    // as NULL.
    let lat = null, lng = null;
    if (form.latitude?.toString().trim() !== '') {
      const v = Number(form.latitude);
      if (!Number.isFinite(v) || v < -90 || v > 90) {
        toast.error(tFallback('gymEdit.latitudeRange', 'Latitude must be a number between {min} and {max}.', { min: -90, max: 90 }));
        return;
      }
      lat = v;
    }
    if (form.longitude?.toString().trim() !== '') {
      const v = Number(form.longitude);
      if (!Number.isFinite(v) || v < -180 || v > 180) {
        toast.error(tFallback('gymEdit.longitudeRange', 'Longitude must be a number between {min} and {max}.', { min: -180, max: 180 }));
        return;
      }
      lng = v;
    }
    // Validate hours: close must be > open per day. Without this, a
    // typo like "open 18:00 → close 06:00" (intending "open 6am →
    // close 6pm") silently saves and the rendering layer can't tell
    // "closed before opening" from "open overnight." Wave 56 (GymEdit
    // audit) caught this. For genuine overnight gyms (open past
    // midnight) the user should add the next day's row instead — v1
    // doesn't model overnight as a single slot.
    for (const day of DAY_ORDER) {
      const slot = form.hours?.[day];
      if (slot?.open && slot?.close && slot.close <= slot.open) {
        toast.error(tFallback('notice.hoursOrder', '{day}: closing time must be after opening time.', { day: DAY_LABEL[day] }));
        return;
      }
    }
    setSaving(true);
    // RLS allows owner-only updates; UPDATE policy already gates on
    // owner_id = auth.uid().
    const { error } = await supabase
      .from('gym_businesses')
      .update({
        name:        form.name.trim(),
        description: form.description.trim() || null,
        logo_url:    form.logo_url || null,
        cover_url:   form.cover_url || null,
        phone:       form.phone || null,
        website_url: form.website_url || null,
        latitude:    lat,
        longitude:   lng,
        hours:       form.hours      || {},
        amenities:   form.amenities  || [],
        photo_urls:  form.photo_urls || [],
        updated_at:  new Date().toISOString(),
      })
      .eq('id', gym.id);
    setSaving(false);
    if (error) {
      toast.error(tFallback('gymEdit.saveFailed', 'Save failed: {reason}', { reason: error.message }));
      return;
    }
    toast.success(tFallback('gymEdit.saved', 'Saved.'));
    navigate(`/gym/${gym.id}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <button
        type="button"
        onClick={() => navigate(`/gym/${gym.id}`)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Back to {gym.name}
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{tFallback("gymEdit.editGym", "Edit gym")}</h1>
          <p className="text-sm text-muted-foreground">{tFallback('gymEdit.subtitle', 'Customize how your gym appears to members.')}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* Cover */}
        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">{tFallback("gymEdit.coverImage", "Cover image")}</label>
          <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-primary/15 to-violet-500/15 aspect-[3/1] mb-2">
            {form.cover_url
              ? <img loading="lazy" src={form.cover_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">{tFallback("gymEdit.noCoverYet", "No cover yet")}</div>}
          </div>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
            {uploadingCover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploadingCover ? 'Uploading…' : 'Upload cover'}
            <input type="file" accept="image/*" className="hidden" onChange={handleCoverPick} />
          </label>
        </div>

        {/* Logo */}
        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">{tFallback("gymEdit.logo", "Logo")}</label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url
                ? <img loading="lazy" src={form.logo_url} alt="" className="w-full h-full object-cover" />
                : <Building2 className="w-6 h-6 text-primary" />}
            </div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploadingLogo ? 'Uploading…' : 'Upload logo'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
            </label>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">Gym name *</label>
          <Input
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value.slice(0, 80) }))}
            maxLength={80}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">{tFallback("regimens.description", "Description")}</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value.slice(0, 500) }))}
            placeholder={tFallback("gymEdit.tellMembersWhatMakes", "Tell members what makes your gym special…")}
            rows={3}
          />
          <p className="text-micro text-muted-foreground tabular-nums text-end mt-1">
            {form.description.length}/500
          </p>
        </div>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">{tFallback("gymEdit.phone", "Phone")}</label>
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value.slice(0, 20) }))}
            />
          </div>
          <div>
            <label className="block text-micro font-bold uppercase tracking-wider text-muted-foreground mb-1">{tFallback("gymEdit.website", "Website")}</label>
            <Input
              type="url"
              inputMode="url"
              value={form.website_url}
              onChange={(e) => setForm(f => ({ ...f, website_url: e.target.value.slice(0, 200) }))}
              placeholder="https://"
            />
          </div>
        </div>

        {/* Geo */}
        <div className="rounded-xl border border-dashed border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">{tFallback("gymEdit.mapPin", "Map pin")}</p>
            <button
              type="button"
              onClick={captureLocation}
              disabled={geoLoading}
              className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 px-2 py-1 rounded"
            >
              {geoLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
              {tFallback('gymEdit.useMyLocation', 'Use my location')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number" inputMode="decimal" step="0.000001"
              value={form.latitude}
              onChange={(e) => setForm(f => ({ ...f, latitude: e.target.value }))}
              placeholder={tFallback("gymEdit.latitude", "Latitude")}
            />
            <Input
              type="number" inputMode="decimal" step="0.000001"
              value={form.longitude}
              onChange={(e) => setForm(f => ({ ...f, longitude: e.target.value }))}
              placeholder={tFallback("gymEdit.longitude", "Longitude")}
            />
          </div>
        </div>

        {/* Hours editor — one row per day with open/close time inputs.
            Leaving both blank for a day means "closed" on that day. */}
        <HoursEditor
          value={form.hours}
          onChange={(next) => setForm(f => ({ ...f, hours: next }))}
        />

        {/* Amenities — chip toggle grid from the controlled vocabulary. */}
        <AmenitiesEditor
          value={form.amenities}
          onChange={(next) => setForm(f => ({ ...f, amenities: next }))}
        />

        {/* Equipment — same pill-toggle shape as Amenities above, but it
            writes straight to space_equipment rather than into `form`.
            Equipment is rows in another table, not a column on this gym,
            so there is nothing for Save to submit and each tap persists
            on its own. Deliberately NOT folded into the form state: a
            half-filled floor should survive the owner navigating away
            without hitting Save. */}
        <GymEquipmentEditor gymId={gym.id} ownerId={gym.owner_id} />

        {/* Photo gallery — multi-image uploader with reorder via
            drag handles in a later pass. v1 = add + remove. */}
        <PhotoGalleryEditor
          gymId={gym.id}
          value={form.photo_urls}
          onChange={(next) => setForm(f => ({ ...f, photo_urls: next }))}
          uploading={uploadingPhoto}
          setUploading={setUploadingPhoto}
          uploadFn={uploadImage}
        />

        <Button onClick={handleSave} disabled={saving} className="w-full h-11 gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </motion.div>
  );
}

// ── Hours editor ────────────────────────────────────────────────────
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function HoursEditor({ value, onChange }) {
  const { tFallback } = useLanguage();
  const updateDay = (key, field, val) => {
    const next = { ...(value || {}) };
    const slot = { ...(next[key] || {}) };
    slot[field] = val || null;
    if (!slot.open && !slot.close) delete next[key];
    else next[key] = slot;
    onChange(next);
  };

  const setAllSame = () => {
    const refDay = value?.mon;
    if (!refDay?.open || !refDay?.close) {
      toast.error(tFallback('gymEdit.setMondayFirst', 'Set Monday’s hours first, then copy them to the other days.'));
      return;
    }
    const next = {};
    for (const k of DAY_ORDER) {
      next[k] = { open: refDay.open, close: refDay.close };
    }
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
          <Clock className="w-3 h-3 inline-block me-1" /> {tFallback("gymEdit.hours", "Hours")}
        </p>
        <button
          type="button"
          onClick={setAllSame}
          className="text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 px-2 py-1 rounded"
        >
          {tFallback('gymEdit.copyMondayToAll', 'Copy Monday to all days')}
        </button>
      </div>
      <div className="space-y-1">
        {DAY_ORDER.map(key => {
          const slot = value?.[key] || {};
          return (
            <div key={key} className="grid grid-cols-[42px_1fr_8px_1fr] items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground">{DAY_LABEL[key]}</span>
              <Input
                type="time"
                value={slot.open || ''}
                onChange={(e) => updateDay(key, 'open', e.target.value)}
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground text-xs text-center">–</span>
              <Input
                type="time"
                value={slot.close || ''}
                onChange={(e) => updateDay(key, 'close', e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          );
        })}
      </div>
      <p className="text-micro text-muted-foreground mt-2">
        {tFallback('gymEdit.blankIsClosed', 'Leave both fields blank to mark a day as closed.')}
      </p>
    </div>
  );
}

// ── Amenities editor ────────────────────────────────────────────────
function AmenitiesEditor({ value, onChange }) {
  const { tFallback } = useLanguage();
  const selected = new Set(value || []);
  const toggle = (slug) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(Array.from(next));
  };
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {tFallback("gymEdit.amenities", "Amenities")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {AMENITY_SLUGS.map(slug => {
          const meta = AMENITY_META[slug];
          const isOn = selected.has(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-micro font-medium border transition-colors ${
                isOn
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary/60 text-muted-foreground border-border hover:bg-secondary active:bg-secondary'
              }`}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {tFallback(`gym.amenity.${slug}`, meta.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Photo gallery editor ────────────────────────────────────────────
const MAX_GALLERY_PHOTOS = 10;

function PhotoGalleryEditor({ gymId, value, onChange, uploading, setUploading, uploadFn }) {
  const { tFallback } = useLanguage();
  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if ((value || []).length >= MAX_GALLERY_PHOTOS) {
      toast.error(tFallback('gymEdit.galleryFull', 'Your gallery is full. Remove a photo to add another.'));
      return;
    }
    setUploading(true);
    const url = await uploadFn(file, 'gallery');
    setUploading(false);
    if (url) onChange([...(value || []), url]);
  };

  const handleRemove = (url) => {
    onChange((value || []).filter(u => u !== url));
  };

  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
          <ImageIcon className="w-3 h-3 inline-block me-1" /> {tFallback("gymEdit.photoGallery", "Photo gallery")}
        </p>
        <label className="inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 px-2 py-1 rounded cursor-pointer">
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          {uploading ? 'Uploading…' : 'Add photo'}
          <input type="file" accept="image/*" className="hidden" onChange={handlePick} disabled={uploading} />
        </label>
      </div>
      {(value || []).length === 0 ? (
        <p className="text-micro text-muted-foreground">
          {tFallback('gymEdit.gallerySwipeHint', 'Members see them as a swipeable rail on your gym page.')}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url) => (
            <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-1 end-1 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center"
                aria-label={tFallback("gymEdit.removePhoto", "Remove photo")}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
