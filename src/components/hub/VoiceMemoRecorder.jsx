// src/components/hub/VoiceMemoRecorder.jsx
//
// Press-and-hold mic button for recording voice memos. Releases the
// recorded blob to the parent via onComplete({ blob, durationMs }).
// Drag-up while holding to cancel (WhatsApp pattern).
//
// Stops recording at MAX_DURATION_MS to avoid runaway audio files.
// Uses the browser's preferred audio MIME type so iOS Safari (which
// favors audio/mp4) and Chrome (audio/webm;codecs=opus) both work.

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Trash2 } from 'lucide-react';

const MAX_DURATION_MS = 60 * 1000;
const CANCEL_DRAG_PX  = 60;

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoiceMemoRecorder({ onComplete, onError }) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef   = useRef([]);
  const startTsRef  = useRef(0);
  const startYRef   = useRef(0);
  const intervalRef = useRef(null);
  const stoppedByCancelRef = useRef(false);

  const cleanup = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const r = recorderRef.current;
    if (r) {
      try { r.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setElapsedMs(0);
    setCancelling(false);
  };

  const start = async (e) => {
    if (recording) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError?.('Voice recording isn\'t supported in this browser.');
      return;
    }
    startYRef.current = e?.clientY ?? 0;
    stoppedByCancelRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data?.size > 0) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        const durationMs = Date.now() - startTsRef.current;
        const wasCancelled = stoppedByCancelRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        cleanup();
        if (!wasCancelled && blob.size > 0 && durationMs >= 500) {
          onComplete?.({ blob, durationMs });
        }
      };
      startTsRef.current = Date.now();
      rec.start();
      setRecording(true);
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTsRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
          try { rec.stop(); } catch { /* ignore */ }
        }
      }, 100);
    } catch {
      onError?.('Microphone permission denied.');
    }
  };

  const finishOrCancel = (cancel) => {
    if (!recording) return;
    stoppedByCancelRef.current = !!cancel;
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
  };

  // Pointer-move while holding: drag up past CANCEL_DRAG_PX cancels.
  const onPointerMove = (e) => {
    if (!recording) return;
    const dy = startYRef.current - (e.clientY ?? 0);
    setCancelling(dy >= CANCEL_DRAG_PX);
  };

  // Release: cancel if dragging-up, otherwise send.
  const onPointerUp = () => {
    if (!recording) return;
    finishOrCancel(cancelling);
  };

  useEffect(() => () => cleanup(), []);

  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); start(e); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => finishOrCancel(true)}
      aria-label={recording ? 'Recording — release to send, drag up to cancel' : 'Hold to record voice memo'}
      className={`relative p-2 rounded-lg transition-colors shrink-0 select-none touch-none ${
        recording
          ? (cancelling ? 'bg-destructive text-destructive-foreground' : 'bg-destructive text-white')
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      {recording
        ? (cancelling ? <Trash2 className="w-4 h-4" /> : <Mic className="w-4 h-4" />)
        : <Mic className="w-4 h-4" />}
      {recording && (
        <span className="absolute -top-7 start-1/2 -translate-x-1/2 text-micro font-bold tabular-nums px-2 py-0.5 rounded-md bg-card border border-border text-foreground whitespace-nowrap">
          {cancelling ? 'Release to cancel' : formatDuration(elapsedMs)}
        </span>
      )}
    </button>
  );
}
