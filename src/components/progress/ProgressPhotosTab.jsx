import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { getDateLocale } from '@/lib/dateLocales';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Trash2, Calendar, Dumbbell, ZoomIn, X, ArrowLeftRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { loadProgressPhotos, deleteProgressPhoto } from './ProgressPhotoCapture';
import { displayWorkoutName } from '@/lib/workoutDisplay';
import PhotoCompareSlider from './PhotoCompareSlider';

export default function ProgressPhotosTab() {
  const { t, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const { user } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [compareMode, setCompareMode] = useState(false);

  useEffect(() => {
    // Per-user load — pass user.id explicitly per the Wave 57 fix in
    // ProgressPhotoCapture.jsx so two users on the same device don't
    // see each other's photos.
    if (!user?.id) return;
    setPhotos(loadProgressPhotos(user.id));
  }, [user?.id]);

  const handleDelete = (id) => {
    const updated = deleteProgressPhoto(id, user?.id);
    setPhotos(updated);
    setConfirmId(null);
    if (lightbox?.id === id) {
      setLightbox(null);
    }
  };

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
            <PhotoCompareSlider photos={photos} onClose={() => setCompareMode(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {photos.map((photo, idx) => (
            <motion.div
              key={photo.id}
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
                  <img
                    src={photo.dataUrl}
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
                    <p className="text-xs text-muted-foreground pl-5 mt-1">
                      {format(new Date(photo.takenAt), 'h:mm a', { locale: dateLocale })}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Dumbbell className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">{displayWorkoutName(photo.workoutName, t)}</p>
                    </div>
                  </div>

                  {/* Delete button area */}
                  <div className="shrink-0">
                    {confirmId === photo.id ? (
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
                          onClick={() => handleDelete(photo.id)}
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
                        onClick={() => setConfirmId(photo.id)}
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
              <img
                src={lightbox.dataUrl}
                alt={t('photos.progressPhoto')}
                className="w-full rounded-2xl object-contain"
                style={{ maxHeight: '80vh' }}
              />
              <div className="flex items-center justify-between mt-4">
                <div>
                   <p className="text-white font-heading font-semibold text-sm">
                      {format(new Date(lightbox.takenAt), 'MMMM d, yyyy · h:mm a', { locale: dateLocale })}
                    </p>
                   <p className="text-white/50 text-xs mt-0.5">{displayWorkoutName(lightbox.workoutName, t)}</p>
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