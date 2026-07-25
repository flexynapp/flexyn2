import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, FlipHorizontal, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { reportError } from '@/lib/reportError';
import { uploadProgressPhoto } from '@/lib/data/progressPhotos';

// ⚠️ DEPRECATED localStorage helpers (read-only path retained for back-compat).
//
// As of the 2026-06 ship-readiness audit (C17) progress photos live in a
// PRIVATE Supabase Storage bucket (`progress-photos`, migration 174),
// read via short-lived signed URLs — see `src/lib/data/progressPhotos.js`.
// The capture flow below uploads there; the per-user localStorage cache is
// no longer written by capture. These read helpers stay only because
// `HubComposer.jsx` still reads recent photos synchronously from
// localStorage to offer them as Hub-post attachments; a one-time migration
// (`migrateLocalProgressPhotos`) drains those entries into Storage, after
// which this localStorage list is empty. Do not add new writers here.
//
// Per-user localStorage namespace per CLAUDE.md convention. The previous
// bare `flexyn_progress_photos` key meant two users on the same device
// (family iPad, shared phone) saw each other's progress photos — a real
// privacy leak (progress photos are intimate, often shirtless). Wave 57
// caught this.
const LEGACY_KEY = 'flexyn_progress_photos';
const storageKey = (userId) => `flexyn.progressPhotos.${userId || 'anon'}`;

// Synchronous best-effort read of current user's id from Supabase's
// localStorage-stored session. supabase-js writes its session under
// `sb-<project>-auth-token`; we read it without an async call so the
// existing synchronous helper signatures stay intact.
function getCurrentUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return parsed?.user?.id || parsed?.currentSession?.user?.id || null;
    }
  } catch { /* ignore */ }
  return null;
}

// One-time migration: if the legacy key has data and the per-user key
// is empty for the current user, move it over and clear the legacy.
function migrateLegacyIfNeeded(userId) {
  if (!userId) return;
  try {
    const userKey = storageKey(userId);
    if (localStorage.getItem(userKey)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    localStorage.setItem(userKey, legacy);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}

// DEPRECATED read helper — retained because HubComposer.jsx reads recent
// progress photos synchronously from localStorage to offer them as
// Hub-post attachments. After `migrateLocalProgressPhotos` drains the
// cache into Storage this returns []. No writer remains in this module;
// capture uploads to the `progress-photos` bucket via the data layer.
export function loadProgressPhotos(userId) {
  const uid = userId || getCurrentUserId();
  migrateLegacyIfNeeded(uid);
  try {
    const data = localStorage.getItem(storageKey(uid));
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Main component
//
// Two modes:
//
//   Uncontrolled (default — used by Workout post-session card):
//     renders its own "Take a progress photo" trigger button. Internal
//     `promptOpen` state drives the dialog.
//
//   Controlled (when `open` prop is provided — e.g. Dashboard quick
//   action): the trigger button is hidden; the parent owns the open
//   state and is notified of closes via `onOpenChange`. This lets the
//   Dashboard "Add photo" CTA jump straight into the prompt dialog
//   without rendering a redundant button on its own surface.
// Note: callers may still pass a `workoutName` prop (Workout post-session
// card). It's intentionally ignored now — progress photos move to the
// private `progress-photos` Storage bucket (mig 174) whose object names
// only encode capture time, so there's no place to persist a free-text
// workout label. The grid no longer shows it.
export default function ProgressPhotoCapture({ open, onOpenChange }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // When `open` is provided we run in controlled mode and the parent
  // owns the dialog state. Otherwise the trigger button toggles our
  // local `promptOpenLocal`.
  const isControlled = open !== undefined;
  const [promptOpenLocal, setPromptOpenLocal] = useState(false);
  const promptOpen = isControlled ? open : promptOpenLocal;
  const setPromptOpen = (next) => {
    if (isControlled) onOpenChange?.(next);
    else setPromptOpenLocal(next);
  };
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  // Holds the captured frame as a JPEG Blob (q0.88) so save can upload
  // the exact pixels without re-encoding the preview dataURL.
  const capturedBlobRef = useRef(null);

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

  // Unmount cleanup — if the component is removed while the camera
  // is still active (parent route change, error boundary trigger,
  // modal closed via Esc through Radix Dialog without going through
  // closeCamera), explicit user-action handlers never fire. Without
  // this, the MediaStream tracks keep running indefinitely: camera
  // privacy light stays on, RAM/CPU leak. Capture streamRef into a
  // local so the cleanup closure does the right thing if streamRef
  // is reassigned between effect run and unmount.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

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

    // Keep the dataURL for the in-dialog preview, and a matching JPEG
    // Blob (same q0.88) for the actual upload.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedImage(dataUrl);
    capturedBlobRef.current = null;
    canvas.toBlob(
      (blob) => { capturedBlobRef.current = blob; },
      'image/jpeg',
      0.88
    );
    stopCamera();
  };

  const closeCamera = () => {
    stopCamera();
    setCapturedImage(null);
    capturedBlobRef.current = null;
    setSaving(false);
    setCameraError(null);
    setCameraOpen(false);
  };

  // Upload the captured frame to the private `progress-photos` bucket.
  // The success toast fires ONLY after the upload resolves — the old
  // localStorage path toasted "Saved" even when a QuotaExceededError
  // silently dropped the photo (C17). On failure we surface an error
  // toast and keep the preview so the user can retry.
  const savePhoto = async () => {
    if (!capturedImage || saving) return;
    if (!user?.id) {
      toast.error(tFallback('photos.saveError', "Couldn't save your photo. Please try again."));
      return;
    }

    // canvas.toBlob is async; if it hasn't landed yet, fall back to
    // converting the preview dataURL so save never silently no-ops.
    let blob = capturedBlobRef.current;
    if (!blob) {
      try {
        blob = await (await fetch(capturedImage)).blob();
      } catch { /* handled by the !blob guard below */ }
    }
    if (!blob) {
      toast.error(tFallback('photos.saveError', "Couldn't save your photo. Please try again."));
      return;
    }

    setSaving(true);
    try {
      await uploadProgressPhoto(user.id, blob, Date.now());
    } catch (err) {
      setSaving(false);
      reportError(err, { feature: 'progressPhoto.upload', userEmail: user?.email });
      toast.error(tFallback('photos.saveError', "Couldn't save your photo. Please try again."));
      return;
    }

    toast.success(t('photos.savedToast'), {
      description: t('photos.savedToastDesc'),
    });
    // Refresh the photo grid (signed-URL list) immediately.
    queryClient.invalidateQueries({ queryKey: ['progressPhotos', user.id] });
    // Quest progress — non-blocking. Was silently swallowed via
    // .catch(() => {}); now reportError so quest-progress breakage
    // (e.g. user's "log a progress photo" quest never advances) is
    // visible in Sentry instead of dying quietly.
    quests.recordAction(user, ACTION_TYPES.PROGRESS_PHOTO, 1)
      .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
      .catch(err => reportError(err, {
        feature: 'progressPhoto.quest-progress',
        level: 'warning',
        userEmail: user?.email,
      }));
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
      {/* Trigger Button — hidden in controlled mode; the parent has its
          own surface and shouldn't show a duplicate button. */}
      {!isControlled && (
        <Button
          onClick={() => setPromptOpen(true)}
          className="w-full h-12 font-heading font-semibold mb-2"
        >
          <Camera className="w-4 h-4 me-2" />
          <span>{t('photos.logPrompt')}</span>
        </Button>
      )}

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
            <DialogContent className="w-full h-[100dvh] max-w-none p-0 border-0 rounded-0 bg-black min-h-[420px]">
              {/* Top Bar */}
              <div className="absolute top-0 start-0 end-0 z-10 p-4 bg-gradient-to-b from-black/70 to-transparent flex items-center justify-between">
                <p className="font-heading font-bold text-white">
                  {capturedImage ? t('photos.preview') : t('photos.progressPhoto')}
                </p>
                <button
                  onClick={closeCamera}
                  aria-label={tFallback('photos.closeCamera', 'Close camera')}
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
              <div className="absolute bottom-0 start-0 end-0 z-10 p-6 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                {!capturedImage ? (
                  <>
                    {/* Flip button */}
                    <button
                      onClick={toggleFacingMode}
                      aria-label={tFallback('photos.flipCamera', 'Flip camera')}
                      className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    >
                      <FlipHorizontal className="w-5 h-5 text-white" />
                    </button>

                    {/* Shutter button — critical that blind users know what
                        this circle does. Without aria-label it's announced
                        as an unlabeled "button". */}
                    <button
                      onClick={capturePhoto}
                      aria-label={tFallback('photos.takePhoto', 'Take photo')}
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
                      disabled={saving}
                      className="flex-1 border-white/30 bg-transparent text-white hover:bg-white/10"
                    >
                      {t('photos.retake')}
                    </Button>
                    <Button
                      onClick={savePhoto}
                      disabled={saving}
                      className="flex-1"
                    >
                      {saving ? tFallback('photos.saving', 'Saving…') : t('photos.savePhoto')}
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