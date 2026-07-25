import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { getDateLocale } from '@/lib/dateLocales';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Trash2, Calendar, ZoomIn, X, ArrowLeftRight, AlertTriangle, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import {
  listProgressPhotos,
  deleteProgressPhoto,
  migrateLocalProgressPhotos,
} from '@/lib/data/progressPhotos';
import { reportError } from '@/lib/reportError';
import PhotoCompareSlider from './PhotoCompareSlider';

export default function ProgressPhotosTab() {
  const { t, tFallback, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [compareMode, setCompareMode] = useState(false);

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

  const handleDelete = (path) => {
    setConfirmId(null);
    if (lightbox?.path === path) {
      setLightbox(null);
    }
    deleteMutation.mutate(path);
  };

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

  // Empty state
  if (photos.length === 0) {
    return (
      <Card className="border-dashed p-12 text-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
          className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
        >
          <Camera className="w-7 h-7 text-primary" />
        </motion.div>
        <h2 className="font-heading font-bold text-lg">{t('photos.emptyTitle')}</h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-2">
          {t('photos.emptyDesc')}
        </p>
      </Card>
    );
  }

  // Populated state
  return (
    <div>
      {/* Count badge + compare toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground font-medium">
            {photos.length === 1 ? t('photos.countOne') : t('photos.countMany').replace('{{count}}', photos.length)}
          </span>
        </div>
        {photos.length >= 2 && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setCompareMode(m => !m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              compareMode
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Compare
          </motion.button>
        )}
      </div>

      {/* Compare slider */}
      <AnimatePresence>
        {compareMode && photos.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden mb-6"
          >
            {/* PhotoCompareSlider consumes { id, dataUrl, takenAt, workoutName }.
                Map the signed-URL list onto that shape so the slider needs no
                edits: path → id, signed url → dataUrl. */}
            <PhotoCompareSlider
              photos={photos.map(p => ({ id: p.path, dataUrl: p.url, takenAt: p.takenAt, workoutName: undefined }))}
              onClose={() => setCompareMode(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {photos.map((photo, idx) => (
            <motion.div
              key={photo.path}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22, delay: idx * 0.05 }}
            >
              <Card className="overflow-hidden border-none shadow-sm">
                {/* Image section */}
                <div
                  className="group cursor-pointer relative"
                  onClick={() => setLightbox(photo)}
                >
                  <img loading="lazy" src={photo.url}
                    alt={t('photos.progressPhoto')}
                    className="w-full object-cover"
                    style={{ maxHeight: 340 }}
                  />
                  <motion.div
                    className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <ZoomIn className="w-6 h-6 text-white" />
                  </motion.div>
                </div>

                {/* Metadata footer */}
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                      <p className="text-sm font-heading font-semibold">
                        {format(new Date(photo.takenAt), 'EEEE, MMMM d, yyyy', { locale: dateLocale })}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground ps-5 mt-1">
                      {format(new Date(photo.takenAt), 'h:mm a', { locale: dateLocale })}
                    </p>
                  </div>

                  {/* Delete button area */}
                  <div className="shrink-0">
                    {confirmId === photo.path ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        className="flex gap-2"
                      >
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleDelete(photo.path)}
                        >
                          {t('common.delete')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmId(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setConfirmId(photo.path)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="max-w-2xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <img loading="lazy" src={lightbox.url}
                alt={t('photos.progressPhoto')}
                className="w-full rounded-2xl object-contain"
                style={{ maxHeight: '80vh' }}
              />
              <div className="flex items-center justify-between mt-4">
                <div>
                   <p className="text-white font-heading font-semibold text-sm">
                      {format(new Date(lightbox.takenAt), 'MMMM d, yyyy · h:mm a', { locale: dateLocale })}
                    </p>
                 </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setLightbox(null)}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}