import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, CameraOff, Zap, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

export default function CameraView({ onCapture, isAnalyzing, exerciseSelected }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('user');
  const [countdown, setCountdown] = useState(null);

  const startCamera = async (mode = facingMode) => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
      const constraints = {
        video: {
          facingMode: mode,
          width: isMobile ? { ideal: 720 } : { ideal: 1280 },
          height: isMobile ? { ideal: 1280 } : { ideal: 720 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraOn(true);
    } catch (e) {
      setCameraError(t('formcoach.cameraAccessDenied'));
      setCameraOn(false);
    }
  };

  const startAnalysis = () => {
    setCountdown(10);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const flipCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (cameraOn) startCamera(next);
  };

  const captureAndAnalyze = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataUrl);
  };

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      captureAndAnalyze();
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="mb-5 flex justify-center">
      <div className="flex flex-col items-center w-full" style={{ maxWidth: '400px' }}>
        <div className="relative rounded-2xl overflow-hidden bg-muted flex items-center justify-center border border-border w-full" style={{ aspectRatio: '9/16', maxHeight: '600px' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''} ${cameraOn ? '' : 'hidden'}`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {!cameraOn && (
            <div className="flex flex-col items-center gap-3 text-muted-foreground p-8 text-center">
              <CameraOff className="w-12 h-12 opacity-40" />
              <p className="text-sm">{cameraError || t('formcoach.cameraOff')}</p>
            </div>
          )}

          {/* Countdown Timer */}
          {countdown !== null && countdown > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-start pt-8 bg-black/30 backdrop-blur-sm">
              <p className="text-white/70 text-sm mb-6">{t('formcoach.holdPosition')}</p>
              <div className="relative w-24 h-24 flex items-center justify-center">
                <div className="absolute w-24 h-24 rounded-full border-4 border-white/30 border-t-white animate-spin" />
                <span className="text-5xl font-heading font-bold text-white relative z-10">{countdown}</span>
              </div>
            </div>
          )}

          {/* Overlay controls on top of video */}
          {cameraOn && (
            <div className="absolute top-3 end-3 flex gap-2">
              <button
                onClick={flipCamera}
                className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 active:bg-black/60 transition-colors"
                title="Flip camera"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={stopCamera}
                className={`w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 active:bg-black/60 transition-colors ${isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}
                title="Turn off camera"
                disabled={isAnalyzing}
              >
                <CameraOff className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-3 w-full">
          {!cameraOn ? (
            <Button className="flex-1" onClick={() => startCamera()} disabled={!exerciseSelected}>
              <Camera className="w-4 h-4 me-2" />
              {t('formcoach.startCamera')}
            </Button>
          ) : countdown === null ? (
            <Button className="flex-1 h-12 font-heading font-bold text-base" onClick={startAnalysis}>
              <Zap className="w-5 h-5 me-2" />
              {t('formcoach.analyze')}
            </Button>
          ) : (
            <Button
              className="flex-1 h-12 font-heading font-bold text-base"
              onClick={captureAndAnalyze}
              disabled={isAnalyzing}
            >
              <Zap className="w-5 h-5 me-2" />
              {isAnalyzing ? t('formcoach.analyzing') : t('formcoach.analyzeMyForm')}
            </Button>
          )}
        </div>

        {cameraOn && !exerciseSelected && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t('formcoach.selectExerciseFirst')}
          </p>
        )}
      </div>
    </div>
  );
}