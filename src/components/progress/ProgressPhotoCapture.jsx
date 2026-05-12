import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, FlipHorizontal, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';

const STORAGE_KEY = 'flexyn_progress_photos';

// Storage helpers
export function saveProgressPhoto(dataUrl, workoutName) {
  const photos = loadProgressPhotos();
  const newEntry = {
    id: `photo_${Date.now()}`,
    dataUrl,
    takenAt: new Date().toISOString(),
    workoutName,
  };
  photos.unshift(newEntry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(photos));
  return newEntry;
}

export function loadProgressPhotos() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function deleteProgressPhoto(id) {
  const photos = loadProgressPhotos();
  const updated = photos.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

// Main component
export default function ProgressPhotoCapture({ workoutName }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [promptOpen, setPromptOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = async (mode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraError(null);
    } catch (err) {
      setCameraError(err.message || 'Failed to access camera');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedImage(dataUrl);
    stopCamera();
  };

  const closeCamera = () => {
    stopCamera();
    setCapturedImage(null);
    setCameraError(null);
    setCameraOpen(false);
  };

  const savePhoto = () => {
    if (!capturedImage) return;
    saveProgressPhoto(capturedImage, workoutName);
    toast.success(t('photos.savedToast'), {
      description: t('photos.savedToastDesc'),
    });
    // Quest progress — non-blocking
    quests.recordAction(user, ACTION_TYPES.PROGRESS_PHOTO, 1)
      .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
      .catch(() => {});
    closeCamera();
  };

  const toggleFacingMode = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    stopCamera();
    setCapturedImage(null);
    await startCamera(newMode);
  };

  const openCamera = () => {
    setPromptOpen(false);
    setCameraOpen(true);
    startCamera(facingMode);
  };

  return (
    <>
      {/* Trigger Button */}
      <Button
        onClick={() => setPromptOpen(true)}
        className="w-full h-12 font-heading font-semibold mb-2"
      >
        <Camera className="w-4 h-4 mr-2" />
        <span>{t('photos.logPrompt')}</span>
      </Button>

      {/* Prompt Dialog */}
      <AnimatePresence>
        {promptOpen && (
          <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <DialogTitle className="font-heading">{t('photos.captureTitle')}</DialogTitle>
                </div>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {t('photos.captureDesc')}
              </p>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => setPromptOpen(false)} className="flex-1">
                  {t('common.skip')}
                </Button>
                <Button onClick={openCamera} className="flex-1">
                  {t('photos.takePhoto')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>

      {/* Camera Dialog */}
      <AnimatePresence>
        {cameraOpen && (
          <Dialog open={cameraOpen} onOpenChange={closeCamera}>
            <DialogContent className="w-full h-screen max-w-none p-0 border-0 rounded-0 bg-black min-h-[420px]">
              {/* Top Bar */}
              <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/70 to-transparent flex items-center justify-between">
                <p className="font-heading font-bold text-white">
                  {capturedImage ? t('photos.preview') : t('photos.progressPhoto')}
                </p>
                <button
                  onClick={closeCamera}
                  aria-label={t('photos.closeCamera') === 'photos.closeCamera' ? 'Close camera' : t('photos.closeCamera')}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Main Content */}
              <div className="relative w-full h-full flex items-center justify-center bg-black">
                <canvas ref={canvasRef} className="hidden" />
                
                {capturedImage ? (
                  <motion.img
                    src={capturedImage}
                    alt="Captured progress"
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : {}}
                  />
                )}

                {cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="text-center">
                      <p className="text-white font-semibold mb-2">{t('photos.cameraDenied')}</p>
                      <p className="text-white/70 text-sm mb-4">{cameraError}</p>
                      <Button onClick={closeCamera} variant="outline">
                        {t('photos.tryAgain')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Controls */}
              <div className="absolute bottom-0 left-0 right-0 z-10 p-6 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                {!capturedImage ? (
                  <>
                    {/* Flip button */}
                    <button
                      onClick={toggleFacingMode}
                      aria-label={t('photos.flipCamera') === 'photos.flipCamera' ? 'Flip camera' : t('photos.flipCamera')}
                      className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    >
                      <FlipHorizontal className="w-5 h-5 text-white" />
                    </button>

                    {/* Shutter button — critical that blind users know what
                        this circle does. Without aria-label it's announced
                        as an unlabeled "button". */}
                    <button
                      onClick={capturePhoto}
                      aria-label={t('photos.takePhoto') === 'photos.takePhoto' ? 'Take photo' : t('photos.takePhoto')}
                      className="w-16 h-16 rounded-full bg-white hover:bg-white/90 transition-colors active:scale-95"
                    />

                    {/* Spacer */}
                    <div className="w-12" />
                  </>
                ) : (
                  <div className="w-full flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setCapturedImage(null)}
                      className="flex-1 border-white/30 bg-transparent text-white hover:bg-white/10"
                    >
                      {t('photos.retake')}
                    </Button>
                    <Button
                      onClick={savePhoto}
                      className="flex-1"
                    >
                      {t('photos.savePhoto')}
                    </Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
}