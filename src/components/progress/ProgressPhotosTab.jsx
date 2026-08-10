/**
 * ProgressPhotosTab — the Photos tab on /progress.
 *
 * Revamped 2026-08-10. What the previous version got wrong, and why the
 * shape below is what it is:
 *
 *   • It had NO way to add a photo. The only capture entry points were the
 *     Workout post-session card and a Dashboard deep-link, so the tab whose
 *     entire subject is photos could not take one — and its empty state
 *     told you to go save a workout instead. `ProgressPhotoCapture` is now
 *     mounted here in controlled mode behind an "Add photo" button.
 *   • Its only zoom affordance was `group-hover:opacity-100`. This app
 *     ships to phones only, where hover never fires, so the affordance did
 *     not exist for any real user. The tile is the button now.
 *   • `md:grid-cols-2 lg:grid-cols-3` are dead breakpoints for the same
 *     reason, which left a permanent ONE-column list of full-width photos:
 *     a dozen photos was a dozen screens of scrolling. Now a 3-up square
 *     grid via `tileRow`, grouped under month headings, because a progress
 *     library is read chronologically.
 *   • Every photo carried a Card plus a metadata footer. Per CLAUDE.md
 *     cards mark discrete user-arranged objects; a photo collection is
 *     read-only data and gets no surface (and `shadow-sm` is banned).
 *   • Dates went through date-fns `format()`, which binds no locale — so
 *     "Friday, August 7, 2026" rendered in English under a fully-Spanish
 *     screen. All dates go through `useDateFormatter()` (`@/lib/intl`).
 *
 * Signed URLs expire (`SIGNED_URL_TTL`, 1h). `staleTime` sits under that
 * ceiling and a failed thumbnail triggers one refetch, so a session left
 * open past the hour re-signs instead of showing a grid of broken images.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useDateFormatter } from '@/lib/intl';
import { tileRow } from '@/lib/tileRows';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Trash2, X, ArrowLeftRight, AlertTriangle, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  listProgressPhotos,
  deleteProgressPhoto,
  migrateLocalProgressPhotos,
} from '@/lib/data/progressPhotos';
import { reportError } from '@/lib/reportError';
import PhotoCompareSlider from './PhotoCompareSlider';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Capture is a camera dialog nobody sees until they tap Add — lazy per the
// modal rule in CLAUDE.md, so it stays out of the Progress page chunk.
const ProgressPhotoCapture = lazy(() => import('./ProgressPhotoCapture'));

// Comfortably under the 1h signed-URL TTL in `@/lib/data/progressPhotos`.
const SIGNED_URL_STALE_MS = 45 * 60 * 1000;

// Three-up square thumbnails. `tileRow` rather than `grid-cols-3` because
// the count comes from data, so the last row is usually partial and a grid
// would pack it against the leading edge — see the rule in CLAUDE.md.
const { row: TILE_ROW, item: TILE_ITEM } = tileRow({ gap: 2, cols: 3 });

export default function ProgressPhotosTab() {
  const { t, tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // The viewer holds an INDEX into `photos`, not a photo object, so prev /
  // next and the post-delete step are a single source of truth.
  const [viewerIndex, setViewerIndex] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  // One retry per mount when a thumbnail 4xx's on an expired signature.
  const resignedRef = useRef(false);

  // Pin the page behind the viewer — see @/lib/scrollLock.
  useBodyScrollLock(viewerIndex !== null);

  // One-time localStorage → Storage migration. Runs once per user
  // (guarded inside the helper). On partial failure it surfaces a toast
  // and keeps the un-uploaded entries for a later retry. We invalidate
  // the list afterward so freshly-migrated photos appear.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    migrateLocalProgressPhotos(user.id)
      .then((res) => {
        if (cancelled || !res?.ran) return;
        if (res.migrated > 0) {
          queryClient.invalidateQueries({ queryKey: ['progressPhotos', user.id] });
        }
        if (res.failed > 0) {
          toast.error(
            tFallback(
              'photos.migratePartial',
              "Some progress photos couldn't be moved to secure storage. We'll retry next time."
            )
          );
        }
      })
      .catch((err) => reportError(err, {
        feature: 'progressPhoto.migrate',
        level: 'warning',
        userEmail: user?.email,
      }));
    return () => { cancelled = true; };
  }, [user?.id, queryClient, tFallback, user?.email]);

  const {
    data: photos = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['progressPhotos', user?.id],
    queryFn: () => listProgressPhotos(user.id),
    enabled: !!user?.id,
    // Signed URLs die after an hour; re-sign before they do rather than
    // rendering a grid of broken images to someone who left the tab open.
    staleTime: SIGNED_URL_STALE_MS,
    refetchOnWindowFocus: true,
  });

  const deleteMutation = useMutation({
    mutationFn: (path) => deleteProgressPhoto(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['progressPhotos', user?.id] });
    },
    onError: (err) => {
      reportError(err, { feature: 'progressPhoto.delete', userEmail: user?.email });
      toast.error(tFallback('photos.deleteError', "Couldn't delete that photo. Please try again."));
    },
  });

  const total = photos.length;
  const viewing = viewerIndex !== null ? photos[viewerIndex] : null;

  // ── Viewer navigation ──────────────────────────────────────────────────

  const closeViewer = useCallback(() => {
    setViewerIndex(null);
    setConfirmDelete(false);
  }, []);

  const step = useCallback((delta) => {
    setConfirmDelete(false);
    setViewerIndex((i) => {
      if (i === null) return null;
      const next = i + delta;
      return next < 0 || next >= total ? i : next;
    });
  }, [total]);

  // Escape closes, arrows page. The old lightbox had neither, and a
  // full-screen overlay you can only dismiss by tapping the backdrop is a
  // trap for anyone on a keyboard.
  useEffect(() => {
    if (viewerIndex === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, closeViewer, step]);

  // A delete can empty the list or drop the last index out of range; clamp
  // rather than leaving the viewer pointed at nothing.
  useEffect(() => {
    if (viewerIndex === null) return;
    if (total === 0) setViewerIndex(null);
    else if (viewerIndex >= total) setViewerIndex(total - 1);
  }, [total, viewerIndex]);

  const handleDelete = (path) => {
    setConfirmDelete(false);
    deleteMutation.mutate(path);
  };

  // A thumbnail that fails to load is almost always an expired signature.
  // Refetch once per mount; a second failure is a real error and is left
  // alone rather than looping.
  const handleImageError = useCallback(() => {
    if (resignedRef.current) return;
    resignedRef.current = true;
    refetch();
  }, [refetch]);

  // ── Chronology ─────────────────────────────────────────────────────────
  // `listProgressPhotos` returns newest-first, so a single pass groups into
  // months without sorting again.
  const months = useMemo(() => {
    const out = [];
    let key = null;
    for (const photo of photos) {
      const d = new Date(photo.takenAt);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k !== key) {
        out.push({ key: k, date: d, items: [] });
        key = k;
      }
      out[out.length - 1].items.push(photo);
    }
    return out;
  }, [photos]);

  const addButton = (
    <Button
      onClick={() => setCaptureOpen(true)}
      className="flex-1 h-12 font-heading font-semibold"
    >
      <Camera className="w-4 h-4 me-2" />
      {tFallback('photos.addPhoto', 'Add photo')}
    </Button>
  );

  // Mounted at every branch — the empty and error states need the capture
  // dialog just as much as the populated one does.
  const captureDialog = (
    <Suspense fallback={null}>
      <ProgressPhotoCapture open={captureOpen} onOpenChange={setCaptureOpen} />
    </Suspense>
  );

  // Loading state
  if (isLoading) {
    return (
      <Card className="border-dashed p-12 text-center">
        <Loader2 className="w-7 h-7 text-primary animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground mt-3">
          {tFallback('photos.loading', 'Loading your photos…')}
        </p>
      </Card>
    );
  }

  // Error state
  if (isError) {
    return (
      <Card className="border-dashed p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-destructive" />
        </div>
        <h2 className="font-heading font-bold text-lg">
          {tFallback('photos.errorTitle', "Couldn't load your photos")}
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-2">
          {tFallback('photos.errorDesc', 'Something went wrong fetching your progress photos.')}
        </p>
        <Button variant="outline" onClick={() => refetch()} className="mt-4">
          {tFallback('photos.tryAgain', 'Try again')}
        </Button>
      </Card>
    );
  }

  // Empty state — now the primary place someone takes their FIRST photo,
  // so the CTA is the point of it. The old copy pointed at the Workout
  // save flow, which is no longer the only way in.
  if (total === 0) {
    return (
      <>
        <Card className="border-dashed p-10 text-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
          >
            <Camera className="w-7 h-7 text-primary" />
          </motion.div>
          <h2 className="font-heading font-bold text-lg">{t('photos.emptyTitle')}</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-2">
            {tFallback(
              'photos.emptyHint',
              "Capture where you're starting from. Your photos are private to you and stored securely."
            )}
          </p>
          <div className="flex mt-6 max-w-xs mx-auto">{addButton}</div>
        </Card>
        {captureDialog}
      </>
    );
  }

  // ── Populated ──────────────────────────────────────────────────────────
  return (
    <div>
      {/* Count + the two actions this surface owns. Add is primary because
          it was the thing you could not do here at all. */}
      <div style={{ marginBottom: 'var(--fluid-section)' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground font-medium">
            {total === 1
              ? t('photos.countOne')
              : t('photos.countMany').replace('{{count}}', total)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {addButton}
          {total >= 2 && (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setCompareMode(m => !m)}
              aria-pressed={compareMode}
              className={`flex items-center justify-center gap-2 h-12 px-4 rounded-xl text-sm font-semibold transition-colors border ${
                compareMode
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'bg-secondary/60 text-muted-foreground border-border/50 hover:text-foreground active:text-foreground'
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
              {tFallback('photos.compare', 'Compare')}
            </motion.button>
          )}
        </div>
      </div>

      {/* Compare slider */}
      <AnimatePresence>
        {compareMode && total >= 2 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
            style={{ marginBottom: 'var(--fluid-section)' }}
          >
            {/* PhotoCompareSlider consumes { id, dataUrl, takenAt }. Map the
                signed-URL list onto that shape: path → id, signed url →
                dataUrl. */}
            <PhotoCompareSlider
              photos={photos.map(p => ({ id: p.path, dataUrl: p.url, takenAt: p.takenAt }))}
              onClose={() => setCompareMode(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Month-grouped thumbnail grid */}
      {months.map((month, mi) => (
        <section key={month.key} style={{ marginBottom: 'var(--fluid-section)' }}>
          <h2 className="text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {fmtDate(month.date, { month: 'long', year: 'numeric' })}
          </h2>
          <div className={TILE_ROW}>
            {month.items.map((photo, i) => {
              // Flat index into `photos`, which is what the viewer pages over.
              const flatIndex = months
                .slice(0, mi)
                .reduce((n, m) => n + m.items.length, 0) + i;
              return (
                <div key={photo.path} className={TILE_ITEM}>
                  <motion.button
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      type: 'spring',
                      stiffness: 260,
                      damping: 22,
                      // Capped so a large library doesn't stagger for
                      // seconds before the last tile appears.
                      delay: Math.min(flatIndex, 8) * 0.03,
                    }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setConfirmDelete(false); setViewerIndex(flatIndex); }}
                    aria-label={`${t('photos.progressPhoto')} — ${fmtDate(new Date(photo.takenAt), { dateStyle: 'long' })}`}
                    className="block w-full aspect-square rounded-lg overflow-hidden bg-secondary border border-border/50"
                  >
                    <img
                      loading="lazy"
                      src={photo.url}
                      onError={handleImageError}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </motion.button>
                  <p className="text-micro text-muted-foreground text-center mt-1">
                    {fmtDate(new Date(photo.takenAt), { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* ── Viewer ──────────────────────────────────────────────────────
          A real dialog this time: labelled, Escape-dismissable, pageable
          by arrow key or swipe, and the only place delete lives — you
          should be looking at the photo you're about to lose for good. */}
      <AnimatePresence>
        {viewing && (
          <motion.div
            key="photo-viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={tFallback('photos.viewer', 'Photo viewer')}
            className="fixed inset-0 z-50 bg-black/95 flex flex-col"
            // Insets only, not `.safe-page` — that class also adds a 24px
            // inline padding, and this viewer wants the image edge to edge.
            // Without them the header sits under the notch and the delete
            // button under the home indicator on every notched iPhone.
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            onClick={closeViewer}
          >
            {/* Header — date + position + close */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-w-0">
                <p className="text-white font-heading font-semibold text-sm truncate">
                  {fmtDate(new Date(viewing.takenAt), { dateStyle: 'long' })}
                </p>
                <p className="text-white/60 text-micro mt-0.5">
                  {fmtDate(new Date(viewing.takenAt), { timeStyle: 'short' })}
                  {' · '}
                  {tFallback('photos.position', '{{index}} of {{total}}')
                    .replace('{{index}}', viewerIndex + 1)
                    .replace('{{total}}', total)}
                </p>
              </div>
              <button
                onClick={closeViewer}
                aria-label={t('common.close')}
                className="shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* Image — drag horizontally to page between photos. `loading`
                is deliberately eager: this is the one image on screen and
                the whole reason the overlay is open, so deferring it shows a
                black rectangle. */}
            <motion.div
              key={viewing.path}
              className="flex-1 min-h-0 flex items-center justify-center px-4"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={(_, info) => {
                if (info.offset.x < -60) step(1);
                else if (info.offset.x > 60) step(-1);
              }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            >
              <img
                src={viewing.url}
                onError={handleImageError}
                alt={t('photos.progressPhoto')}
                draggable={false}
                className="max-w-full max-h-full object-contain rounded-2xl select-none"
              />
            </motion.div>

            {/* Footer — paging + delete */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => step(-1)}
                disabled={viewerIndex === 0}
                aria-label={tFallback('photos.prev', 'Previous photo')}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/20 disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-white rtl:scale-x-[-1]" />
              </button>

              {confirmDelete ? (
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-micro text-white/70">
                    {tFallback('photos.deletePermanent', 'This cannot be undone.')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 px-3 text-xs"
                      disabled={deleteMutation.isPending}
                      onClick={() => handleDelete(viewing.path)}
                    >
                      {deleteMutation.isPending
                        ? tFallback('photos.deleting', 'Deleting…')
                        : t('common.delete')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs text-white hover:bg-white/10 active:bg-white/10"
                      onClick={() => setConfirmDelete(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  aria-label={tFallback('photos.deleteConfirm', 'Delete this photo?')}
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-destructive/80 active:bg-destructive/80 flex items-center justify-center transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-white" />
                </button>
              )}

              <button
                onClick={() => step(1)}
                disabled={viewerIndex === total - 1}
                aria-label={tFallback('photos.next', 'Next photo')}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/20 disabled:opacity-30 flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-white rtl:scale-x-[-1]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {captureDialog}
    </div>
  );
}
