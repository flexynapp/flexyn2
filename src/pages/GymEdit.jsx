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
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import EmptyState from '@/components/EmptyState';
import { getGym } from '@/lib/data/gymBusinesses';

export default function GymEdit() {
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
        <EmptyState icon={Building2} title="Gym not found" body="That gym ID doesn't exist." />
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState icon={Building2} title="Not authorized" body="Only the gym owner can edit this page." />
      </div>
    );
  }

  // Image upload helper — shared by logo + cover. Uploads to the
  // "avatars" bucket under gym/<gymId>/<kind>-<timestamp>.<ext> so
  // each gym's assets are namespaced under its id (easier to clean
  // up later + simple RLS by owner_id is straightforward via prefix).
  const uploadImage = async (file, kind) => {
    if (!file || !user?.id) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `gym/${gym.id}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
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
    if (!navigator.geolocation) { toast.error('Geolocation not supported.'); return; }
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
      (err) => { setGeoLoading(false); toast.error(err.message); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.name.trim()) { toast.error('Name required.'); return; }
    const lat = form.latitude  ? Number(form.latitude)  : null;
    const lng = form.longitude ? Number(form.longitude) : null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error('Valid latitude + longitude required.');
      return;
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
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success('Saved.');
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
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> Back to {gym.name}
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Edit gym</h1>
          <p className="text-sm text-muted-foreground">Customize how your gym appears to members.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* Cover */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Cover image</label>
          <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-primary/15 to-violet-500/15 aspect-[3/1] mb-2">
            {form.cover_url
              ? <img src={form.cover_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No cover yet</div>}
          </div>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
            {uploadingCover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploadingCover ? 'Uploading…' : 'Upload cover'}
            <input type="file" accept="image/*" className="hidden" onChange={handleCoverPick} />
          </label>
        </div>

        {/* Logo */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Logo</label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url
                ? <img src={form.logo_url} alt="" className="w-full h-full object-cover" />
                : <Building2 className="w-6 h-6 text-primary" />}
            </div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploadingLogo ? 'Uploading…' : 'Upload logo'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
            </label>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Gym name *</label>
          <Input
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value.slice(0, 80) }))}
            maxLength={80}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Description</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value.slice(0, 500) }))}
            placeholder="Tell members what makes your gym special…"
            rows={3}
          />
          <p className="text-[10px] text-muted-foreground tabular-nums text-right mt-1">
            {form.description.length}/500
          </p>
        </div>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Phone</label>
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value.slice(0, 20) }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Website</label>
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
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Map pin</p>
            <button
              type="button"
              onClick={captureLocation}
              disabled={geoLoading}
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary/10 px-2 py-1 rounded"
            >
              {geoLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
              Use my location
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number" inputMode="decimal" step="0.000001"
              value={form.latitude}
              onChange={(e) => setForm(f => ({ ...f, latitude: e.target.value }))}
              placeholder="Latitude"
            />
            <Input
              type="number" inputMode="decimal" step="0.000001"
              value={form.longitude}
              onChange={(e) => setForm(f => ({ ...f, longitude: e.target.value }))}
              placeholder="Longitude"
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
      toast.error('Set Monday first, then tap "Copy to all days".');
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
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Clock className="w-3 h-3 inline-block mr-1" /> Hours
        </p>
        <button
          type="button"
          onClick={setAllSame}
          className="text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary/10 px-2 py-1 rounded"
        >
          Copy Mon → all days
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
      <p className="text-[10px] text-muted-foreground mt-2">
        Leave both fields blank to mark a day as closed.
      </p>
    </div>
  );
}

// ── Amenities editor ────────────────────────────────────────────────
function AmenitiesEditor({ value, onChange }) {
  const selected = new Set(value || []);
  const toggle = (slug) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(Array.from(next));
  };
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Amenities
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
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                isOn
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary/60 text-muted-foreground border-border hover:bg-secondary'
              }`}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {meta.label}
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
  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if ((value || []).length >= MAX_GALLERY_PHOTOS) {
      toast.error(`Max ${MAX_GALLERY_PHOTOS} photos.`);
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
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <ImageIcon className="w-3 h-3 inline-block mr-1" /> Photo gallery
        </p>
        <label className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary/10 px-2 py-1 rounded cursor-pointer">
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          {uploading ? 'Uploading…' : 'Add photo'}
          <input type="file" accept="image/*" className="hidden" onChange={handlePick} disabled={uploading} />
        </label>
      </div>
      {(value || []).length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Up to {MAX_GALLERY_PHOTOS} photos. Members see them as a swipeable rail on your hub page.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url) => (
            <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center"
                aria-label="Remove photo"
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
